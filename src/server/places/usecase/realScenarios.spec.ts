import { runAgent } from '@server/agent/usecase/agent';
import { recommendedPlaceIdsForTools } from '@server/agent/usecase/reply';
import { resetEnvCache } from '@server/kernel/env';
import { findPlacesResultSchema, resolvedLocationSchema, walkPlanSchema } from '@server/places/model/places.schema';
import { hasNotabilitySignal, isGenericName } from '@server/places/model/rank';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real pipeline: scripted agent, real tools, committed data/poi.json, fixed clock (12:00 Astana).
const ctx = { now: new Date('2026-10-19T07:00:00Z') };
const NEAR_EXPO = { lat: 51.089, lon: 71.416 };
const NEAR_BAYTEREK = { lat: 51.128, lon: 71.43 };
const NEAR_KHAN_SHATYR = { lat: 51.13251, lon: 71.40387 };
const ALEM_AI = 'osm:way/454857501';
const BAYTEREK = 'osm:way/230401645';

beforeEach(() => {
	vi.stubEnv('LLM_PROVIDER', 'mock');
	// Deterministic ranking: no Python process or weights cache in a unit run.
	resetEnvCache();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

async function ask(text: string, location?: { lat: number; lon: number }) {
	const messages = [{ content: text, role: 'user' as const }];
	const answer = await runAgent(ctx, { messages, ...(location ? { location } : {}) });
	// The same server-side selection the chat route returns to the screen.
	return { ...answer, recommendedPlaceIds: recommendedPlaceIdsForTools({ messages, toolCalls: answer.toolCalls }) };
}

type Answer = Awaited<ReturnType<typeof ask>>;

function expectRecommendations(answer: Answer, source: 'browser' | 'text') {
	const { reply, toolCalls } = answer;
	expect(toolCalls.every((call) => call.status === 'ok')).toBe(true);
	expect(reply).toMatch(
		new RegExp(`^Локация: .+ \\(${source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}\\)\\.$`, 'mu'),
	);
	expect(reply).not.toContain('Запрос:');
	expect(reply).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
	const search = findPlacesResultSchema.parse(toolCalls.find((call) => call.name === 'find_places')?.result);
	const items = reply.split('\n\n').filter((part) => /^\d+\. /u.test(part));
	expect(items.length).toBeGreaterThanOrEqual(1);
	expect(items.length).toBeLessThanOrEqual(3);
	expect(answer.recommendedPlaceIds).toHaveLength(items.length);
	for (const item of items) {
		expect(item).toMatch(/\d+ м, \d+ мин пешком/u);
		expect(item).toContain('Почему:');
		expect(item).toContain('Что делать:');
		expect(item).toMatch(/OpenStreetMap|Wikidata/u);
		const title = item.replace(/^\d+\. /u, '');
		const candidate = search.candidates.find((entry) => title.startsWith(`${entry.place.name} — `));
		expect(candidate).toBeDefined();
		if (candidate!.open.status !== 'open') expect(item).not.toMatch(/(?:^|[^а-яё])открыт/iu);
	}
	return { items, search };
}

function expectAsksLocation(answer: Answer) {
	expect(answer.toolCalls.some((call) => call.name === 'find_places')).toBe(false);
	expect(answer.reply).toContain('Где вы сейчас находитесь?');
}

function resolved(answer: Answer) {
	return resolvedLocationSchema.parse(answer.toolCalls.find((call) => call.name === 'resolve_location')?.result);
}

describe('real scenarios through the mock agent and the committed dataset', () => {
	it('answers the case example at EXPO with places instead of a clarification', async () => {
		const answer = await ask('Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.');

		expect(answer.toolCalls.map((call) => call.name)).toEqual(['resolve_location', 'find_places']);
		expect(resolved(answer)).toMatchObject({ found: true, matchedPlaceId: ALEM_AI });
		expect(answer.reply).not.toContain('Не удалось однозначно');
		expect(answer.reply).toMatch(/Локация: .*Alem\.ai.*ЭКСПО/u);
		expectRecommendations(answer, 'text');
		expect(answer.recommendedPlaceIds).not.toContain(ALEM_AI);
	});

	it('does not recommend the museum to a visitor standing at it', async () => {
		const answer = await ask('Я у музея Нур Алем, хочу посмотреть музей или необычное место на 1–2 часа пешком.');

		expect(resolved(answer)).toMatchObject({ found: true, matchedPlaceId: ALEM_AI });
		const search = findPlacesResultSchema.parse(answer.toolCalls.find((call) => call.name === 'find_places')?.result);
		expect(search.candidates.map((candidate) => candidate.place.id)).not.toContain(ALEM_AI);
		expect(answer.reply).not.toMatch(/^\d+\. Alem\.ai/mu);
	});

	it('resolves an inflected Baiterek and does not recommend the monument itself', async () => {
		const answer = await ask('Я у Байтерека, хочу прогуляться на 60 минут');

		expect(resolved(answer)).toMatchObject({ found: true, matchedPlaceId: BAYTEREK });
		const { search } = expectRecommendations(answer, 'text');
		expect(search.candidates.map((candidate) => candidate.place.id)).not.toContain(BAYTEREK);
	});

	it('resolves an inflected Khan Shatyr', async () => {
		const answer = await ask('Я у Хан Шатыра, хочу прогуляться на час');

		expect(resolved(answer).found).toBe(true);
		expectRecommendations(answer, 'text');
	});

	it('answers the Mega Silk Way walk', async () => {
		const answer = await ask('Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут — что посоветуете?');

		expect(resolved(answer).found).toBe(true);
		expectRecommendations(answer, 'text');
	});

	it('answers the coffee request from the browser location', async () => {
		expectRecommendations(await ask('Хочу тихое место с кофе и розеткой недалеко от меня.', NEAR_EXPO), 'browser');
	});

	it('asks for a location when the coffee request has none', async () => {
		expectAsksLocation(await ask('Хочу тихое место с кофе и розеткой недалеко от меня.'));
	});

	it('answers the child request from the browser location', async () => {
		expectRecommendations(
			await ask('Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?', NEAR_EXPO),
			'browser',
		);
	});

	it('asks a departing tourist where they are and does not treat the flight as a location', async () => {
		const answer = await ask('Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?');

		expectAsksLocation(answer);
		expect(answer.toolCalls.some((call) => call.name === 'resolve_location')).toBe(false);
	});

	it('answers a departing tourist with a browser location', async () => {
		const answer = await ask(
			'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
			NEAR_BAYTEREK,
		);

		expect(expectRecommendations(answer, 'browser').items.length).toBeLessThanOrEqual(2);
	});

	it('answers the night request with open places only', async () => {
		const answer = await ask('Ищу необычную ночную активность (последние пару часов).', NEAR_BAYTEREK);
		const { items, search } = expectRecommendations(answer, 'browser');

		for (const id of answer.recommendedPlaceIds) {
			expect(search.candidates.find((candidate) => candidate.place.id === id)?.open.status).toBe('open');
		}
		expect(items.length).toBeGreaterThan(0);
	});

	it('offers two or three different sights for «необычное» at EXPO, never a playground', async () => {
		const answer = await ask('Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.');
		const { items, search } = expectRecommendations(answer, 'text');
		const chosen = answer.recommendedPlaceIds.map(
			(id) => search.candidates.find((candidate) => candidate.place.id === id)!.place,
		);

		expect(items.length).toBeGreaterThanOrEqual(2);
		expect(chosen.map((place) => place.category)).not.toContain('playground');
		expect(new Set(chosen.map((place) => place.category)).size).toBeGreaterThanOrEqual(2);
	});

	// Within 15 minutes of Baiterek there are only a square and two galleries (no monuments or
	// artworks in the dataset), so an honest 60-minute plan has one stop. From 90 minutes the three
	// stops the user asked for fit once some visits are shortened (QA: it used to stop at two).
	it.each([
		[60, 1],
		[90, 3],
		[120, 3],
	])('plans a %i-minute route from Baiterek with at least %i stop(s)', async (minutes, minStops) => {
		const answer = await ask(`Я у Байтерека, составь маршрут из трёх мест на ${minutes} минут.`);
		const plan = walkPlanSchema.parse(answer.toolCalls.find((call) => call.name === 'plan_walk')?.result);
		const ids = plan.stops.map((stop) => stop.candidate.place.id);

		expect(resolved(answer)).toMatchObject({ found: true, matchedPlaceId: BAYTEREK });
		expect(plan.stops.length).toBeGreaterThanOrEqual(minStops);
		expect(plan.stops.length).toBeLessThanOrEqual(3);
		expect(plan.totalMinutes).toBeLessThanOrEqual(minutes);
		expect(ids).not.toContain(BAYTEREK);
		expect(answer.recommendedPlaceIds).toEqual(ids);
		expect(answer.recommendations?.map((item) => item.placeId) ?? []).toEqual(ids);
		expect(answer.recommendations?.map((item) => item.walkMinutes) ?? []).toEqual(
			plan.legs.map((leg) => leg.walkMinutes),
		);
		// Asked for three and given fewer: the reply says so instead of quietly dropping one.
		if (plan.stops.length < 3) expect(answer.reply).toContain('Три места за');
		else expect(answer.reply).not.toContain('не помещаются');
		// The whole budget and the leg limit are named apart; the network caveat appears once.
		expect(answer.reply).toContain(`Вся прогулка — до ${minutes} мин`);
		expect(answer.reply.split('пешеходным дорожкам').length).toBeLessThanOrEqual(2);
	});

	it('labels the search radius and the whole walk apart for a route request', async () => {
		const answer = await ask('Я у Байтерека, составь маршрут из трёх мест на 90 минут.');
		const search = findPlacesResultSchema.parse(answer.toolCalls.find((call) => call.name === 'find_places')?.result);

		expect(search.usedFilters).toContain('До 23 мин пешком до каждого места');
		expect(search.usedFilters).toContain('Вся прогулка — до 90 мин');
		expect(answer.reply).toContain('один переход — до 23 мин пешком');
	});

	it('never recommends a generic-named square to a departing tourist and ties every card to the text', async () => {
		const answer = await ask('Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', {
			lat: 51.12829,
			lon: 71.43045,
		});
		const { items, search } = expectRecommendations(answer, 'browser');
		const names = answer.recommendedPlaceIds.map(
			(id) => search.candidates.find((candidate) => candidate.place.id === id)!.place.name,
		);

		expect(names).not.toContain('Сквер');
		expect(answer.reply).not.toMatch(/Сквер|Парк —/u);
		expect(answer.recommendations?.map((item) => item.placeId)).toEqual(answer.recommendedPlaceIds);
		for (const [index, item] of answer.recommendations!.entries()) {
			expect(items[index]).toContain(`Почему: ${item.why}.`);
			expect(items[index]).toContain(`Что делать: ${item.action} (сгенерированная идея).`);
			expect(items[index]).toContain(`Часы: ${item.hours}.`);
		}
	});

	it('leads «необычное» at EXPO with a named sight and never calls a park a match', async () => {
		const answer = await ask('Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.');
		const { items, search } = expectRecommendations(answer, 'text');
		const first = search.candidates.find((candidate) => candidate.place.id === answer.recommendedPlaceIds[0])!;

		expect(['attraction', 'artwork', 'monument', 'museum', 'gallery', 'theatre', 'viewpoint']).toContain(
			first.place.category,
		);
		for (const item of items.filter((text) => /^Почему: парк/mu.test(text)))
			expect(item).not.toContain('совпадает с запросом');
	});

	it('lists the night answer from the nearest open place', async () => {
		const answer = await runAgent(
			{ now: new Date('2026-10-19T18:30:00Z') },
			{
				location: NEAR_BAYTEREK,
				messages: [{ content: 'Ищу необычную ночную активность (последние пару часов).', role: 'user' }],
			},
		);
		const distances = answer.recommendations?.map((item) => item.distanceM) ?? [];

		expect(distances.length).toBeGreaterThan(0);
		expect(distances).toEqual(distances.toSorted((left, right) => left - right));
		expect(answer.reply).toContain('от ближнего к дальнему');
	});

	it('answers the child request near Baiterek with a kids-tagged place', async () => {
		const answer = await ask(
			'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
			NEAR_BAYTEREK,
		);
		const { search } = expectRecommendations(answer, 'browser');
		const chosen = answer.recommendedPlaceIds.map(
			(id) => search.candidates.find((candidate) => candidate.place.id === id)!.place,
		);

		expect(chosen.some((place) => place.tags.includes('kids') || place.category === 'museum')).toBe(true);
		expect(chosen.some((place) => place.name !== 'Gymboree')).toBe(true);
	});

	// QA on real data: «Корме» and «Астана-Экспо КС» (no description, photo, Wikidata or popularity)
	// were the whole answer at Baiterek, while the Wikidata-described mosque and Astana Musical are
	// a few minutes further. A sightseeing answer must lead with places the data can vouch for.
	it.each([
		['Я у Байтерека, что посмотреть рядом за час?', undefined],
		['Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.', undefined],
		['Что посмотреть рядом?', NEAR_KHAN_SHATYR],
	])('vouches for at least one sight with a data signal: %s', async (text, location) => {
		const answer = await ask(text, location);
		const { search } = expectRecommendations(answer, location ? 'browser' : 'text');
		const chosen = answer.recommendedPlaceIds.map(
			(id) => search.candidates.find((candidate) => candidate.place.id === id)!.place,
		);

		expect(chosen.some(hasNotabilitySignal)).toBe(true);
		expect(
			chosen.filter((place) => place.category === 'gallery' && !hasNotabilitySignal(place)).length,
		).toBeLessThanOrEqual(1);
	});

	it('gives a child near Baiterek at most one generic «Детская площадка»', async () => {
		const answer = await ask(
			'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
			NEAR_BAYTEREK,
		);
		const { search } = expectRecommendations(answer, 'browser');
		const names = answer.recommendedPlaceIds.map(
			(id) => search.candidates.find((candidate) => candidate.place.id === id)!.place.name,
		);

		expect(names.filter((name) => /^детская площадка(?:,|$)/iu.test(name.trim())).length).toBeLessThanOrEqual(1);
	});

	// Within the route's reach the only vouched-for places are a theatre (a 120-minute show), the
	// mosque (not a route category) and Парк Жетысу (no third stop fits after it), so the route is
	// held to named sights: no «Сквер», no unvouched gallery, never gallery after gallery.
	it('routes 90 minutes from Baiterek through named sights, never «Сквер» or two galleries in a row', async () => {
		const answer = await ask('Я у Байтерека, составь маршрут из трёх мест на 90 минут.');
		const plan = walkPlanSchema.parse(answer.toolCalls.find((call) => call.name === 'plan_walk')?.result);
		const places = plan.stops.map((stop) => stop.candidate.place);

		expect(places).toHaveLength(3);
		expect(places.filter((place) => isGenericName(place.name))).toEqual([]);
		expect(places.filter((place) => place.category === 'gallery' && !hasNotabilitySignal(place))).toEqual([]);
		for (const [index, place] of places.entries())
			if (index > 0) expect(place.category === 'gallery' && places[index - 1]!.category === 'gallery').toBe(false);
	});

	it('builds the mini route with a sourced location line', async () => {
		const answer = await ask('Составь маршрут из двух-трёх мест на 90 минут.', NEAR_BAYTEREK);
		const plan = walkPlanSchema.parse(answer.toolCalls.find((call) => call.name === 'plan_walk')?.result);

		expect(answer.reply).toMatch(/^Локация: .+ \(геолокация браузера\)\.$/mu);
		expect(plan.stops.length).toBeGreaterThanOrEqual(2);
		expect(plan.stops.length).toBeLessThanOrEqual(3);
		expect(plan.totalMinutes).toBeLessThanOrEqual(90);
	});
});
