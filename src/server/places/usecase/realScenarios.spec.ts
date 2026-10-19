import { runAgent } from '@server/agent/usecase/agent';
import { recommendedPlaceIdsForTools } from '@server/agent/usecase/reply';
import { resetEnvCache } from '@server/kernel/env';
import { findPlacesResultSchema, resolvedLocationSchema, walkPlanSchema } from '@server/places/model/places.schema';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real pipeline: scripted agent, real tools, committed data/poi.json, fixed clock (12:00 Astana).
const ctx = { now: new Date('2026-10-19T07:00:00Z') };
const NEAR_EXPO = { lat: 51.089, lon: 71.416 };
const NEAR_BAYTEREK = { lat: 51.128, lon: 71.43 };
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

	it('builds the mini route with a sourced location line', async () => {
		const answer = await ask('Составь маршрут из двух-трёх мест на 90 минут.', NEAR_BAYTEREK);
		const plan = walkPlanSchema.parse(answer.toolCalls.find((call) => call.name === 'plan_walk')?.result);

		expect(answer.reply).toMatch(/^Локация: .+ \(геолокация браузера\)\.$/mu);
		expect(plan.stops.length).toBeGreaterThanOrEqual(2);
		expect(plan.stops.length).toBeLessThanOrEqual(3);
		expect(plan.totalMinutes).toBeLessThanOrEqual(90);
	});
});
