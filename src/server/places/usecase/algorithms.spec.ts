import { runAgent } from '@server/agent/usecase/agent';
import { executeTool } from '@server/agent/usecase/tools';
import { resetEnvCache } from '@server/kernel/env';
import { type Place, walkPlanSchema } from '@server/places/model/places.schema';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { placesDependencies } from './dependencies';
import { findPlaces } from './findPlaces';
import { getPlace } from './getPlace';
import { planWalk } from './planWalk';
import { resolveLocation } from './resolveLocation';

// Entirely synthetic POIs. Only the data boundary is substituted; algorithms and tools are real.
const POINT = { lat: 51.128, lon: 71.43 };
const PLACES: Place[] = [1, 2, 3].map((id) => ({
	...POINT,
	address: null,
	category: id === 1 ? 'cafe' : 'monument',
	description: null,
	descriptionSource: null,
	id: `osm:node/${id}`,
	name: id === 1 ? 'Тестовое кафе' : `Тестовый памятник ${id}`,
	nameEn: null,
	openingHours: id === 3 ? null : '24/7',
	phone: null,
	popularity: null,
	sourceUrl: `https://www.openstreetmap.org/node/${id}`,
	tags: id === 1 ? ['power_sockets'] : [],
	website: null,
	wheelchair: 'yes',
}));

function context(places: readonly Place[] = PLACES): PlacesContext {
	return {
		browserLocation: POINT,
		now: new Date('2026-10-19T12:00:00+05:00'),
		places: {
			...placesDependencies,
			getPlaceById: (id) => places.find((place) => place.id === id) ?? null,
			readPlaces: () => places,
		},
	};
}

beforeEach(() => {
	vi.stubEnv('LLM_PROVIDER', 'mock');
	resetEnvCache();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('connected places algorithms', () => {
	it('connects the default data repositories to the validated tool dispatcher', async () => {
		const ctx: PlacesContext = { browserLocation: POINT, now: new Date('2026-10-19T12:00:00+05:00') };
		const result = await executeTool(ctx, { args: { categories: ['cafe'], query: 'кофе' }, name: 'find_places' });
		expect(result.status).toBe('ok');
		const found = await findPlaces(ctx, { categories: ['cafe'], query: 'кофе' });
		expect(found.candidates.length).toBeGreaterThan(0);
		for (const candidate of found.candidates) {
			expect(getPlace(ctx, { id: candidate.place.id })).toEqual(candidate.place);
			expect(candidate.walkMinutes).toBeLessThanOrEqual(15);
		}
	});
	it.each([30, 60, 90])('plans within %i minutes using the default real dataset', async (durationMinutes) => {
		const ctx: PlacesContext = { browserLocation: POINT, now: new Date('2026-10-19T12:00:00+05:00') };
		const route = await planWalk(ctx, { durationMinutes, start: POINT });
		expect(route.stops.length).toBeGreaterThan(0);
		expect(route.totalMinutes).toBeLessThanOrEqual(durationMinutes);
		for (const stop of route.stops)
			expect(getPlace(ctx, { id: stop.candidate.place.id })).toEqual(stop.candidate.place);
	});
	it('filters the full visit budget before truncating the ranked candidate list', async () => {
		const museums = Array.from({ length: 10 }, (_, index): Place => ({
			...PLACES[0]!,
			category: 'museum',
			id: `osm:node/${index + 10}`,
			popularity: 1,
		}));
		const route = await planWalk(context([...museums, PLACES[0]!]), { durationMinutes: 30, start: POINT });
		expect(route.stops.map((stop) => stop.candidate.place.id)).toEqual(['osm:node/1']);
	});
	it('retrieves preferences offline with the default algorithm dependencies', async () => {
		const found = await findPlaces(context(), { query: 'кофе розетка' });
		expect(found.candidates[0]!.place.id).toBe('osm:node/1');
		expect(found.candidates[0]!.why.tags).toEqual(['power_sockets']);
		expect(found.note).toContain('лексический');
	});
	it.each([30, 60, 90])('plans an actual route within %i minutes through the usecase', async (durationMinutes) => {
		const route = await planWalk(context(), { durationMinutes, start: POINT });
		expect(walkPlanSchema.safeParse(route).success).toBe(true);
		expect(route.stops.length).toBeGreaterThan(0);
		expect(route.totalMinutes).toBeLessThanOrEqual(durationMinutes);
		expect(route.totalMinutes).toBe(
			route.legs.reduce((sum, leg) => sum + leg.walkMinutes, 0) +
				route.stops.reduce((sum, stop) => sum + stop.candidate.visitMinutes, 0),
		);
	});
	it('uses one available place when a second stop cannot fit', async () => {
		const route = await planWalk(context([PLACES[0]!]), { durationMinutes: 30, start: POINT });
		expect(route.stops).toHaveLength(1);
		expect(route.totalMinutes).toBe(30);
	});
	it('excludes unknown hours on the server at night', async () => {
		const ctx = context();
		ctx.now = new Date('2026-10-19T23:00:00+05:00');
		const found = await findPlaces(ctx, { query: 'памятник' });
		expect(found.candidates.length).toBeGreaterThan(0);
		expect(found.candidates.every((candidate) => candidate.open.status === 'open')).toBe(true);
	});
	it('preserves location resolution, place lookup and tool dispatch', async () => {
		const ctx = context();
		expect(resolveLocation(ctx, { text: 'Я у Тестовое кафе' }).matchedPlaceId).toBe('osm:node/1');
		expect(getPlace(ctx, { id: 'osm:node/1' })).toEqual(PLACES[0]);
		const call = await executeTool(ctx, { args: { query: 'кофе' }, name: 'find_places' });
		expect(call.status).toBe('ok');
	});
	it('demonstrates a route using real tools and preserves the pre-flight reserve rule', async () => {
		const ctx = context();
		const result = await runAgent(ctx, {
			location: POINT,
			messages: [{ content: 'Построй маршрут на 60 минут', role: 'user' }],
		});
		expect(result.toolCalls.map((call) => call.name)).toEqual(['find_places', 'plan_walk']);
		expect(result.toolCalls.every((call) => call.status === 'ok')).toBe(true);
		const beforeFlight = await runAgent(ctx, {
			location: POINT,
			messages: [{ content: 'Построй маршрут на 2 часа перед вылетом', role: 'user' }],
		});
		expect(beforeFlight.toolCalls.map((call) => call.name)).not.toContain('plan_walk');
		expect(beforeFlight.reply).toContain('досмотра');
	});
});
