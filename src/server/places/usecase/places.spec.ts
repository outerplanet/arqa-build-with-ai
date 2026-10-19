import { runAgent } from '@server/agent/usecase/agent';
import { executeTool } from '@server/agent/usecase/tools';
import { resetEnvCache } from '@server/kernel/env';
import { type Candidate, type Place } from '@server/places/model/places.schema';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { type PlacesDependencies } from './dependencies';
import { findPlaces } from './findPlaces';
import { getPlace } from './getPlace';
import { planWalk } from './planWalk';
import { resolveLocation } from './resolveLocation';

/** Synthetic fixtures; these are not assertions about real Astana POIs. */
const place: Place = {
	address: null,
	category: 'museum',
	description: null,
	descriptionSource: null,
	id: 'osm:way/454857501',
	lat: 51.123456,
	lon: 71.456789,
	name: 'Нур Алем',
	nameEn: null,
	openingHours: null,
	phone: null,
	popularity: null,
	sourceUrl: 'https://www.openstreetmap.org/node/1',
	tags: [],
	website: null,
	wheelchair: null,
};
const candidate: Candidate = {
	distanceM: 100,
	open: { confidence: 'none', note: 'Часы работы неизвестны', opensAt: null, status: 'unknown', until: null },
	place,
	score: 0.8,
	visitMinutes: 30,
	walkMinutes: 2,
	why: { distance: 0.9, open: 0, popularity: 0, semantic: 0.7, tags: [] },
};

function fixture(): { ctx: PlacesContext; deps: PlacesDependencies } {
	const deps: PlacesDependencies = {
		getPlaceById: vi.fn((id) => (id === place.id ? place : null)),
		lexicalScores: vi.fn(() => new Map([[place.id, 0.7]])),
		planWalk: vi.fn(() => ({ legs: [], note: 'По прямой ×1,3', stops: [], totalMinutes: 0 })),
		rankPlaces: vi.fn(() => [candidate]),
		readPlaces: vi.fn(() => [place]),
		readVectors: vi.fn(() => null),
	};
	return {
		ctx: { browserLocation: { lat: 51.1, lon: 71.4 }, now: new Date('2026-10-19T08:00:00Z'), places: deps },
		deps,
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

describe('places usecases', () => {
	it('rejects a location invented by the model rather than stated by the user', async () => {
		const { ctx, deps } = fixture();
		Object.assign(ctx, { userMessages: ['Хочу кофе рядом со мной'] });
		const result = await executeTool(ctx, { args: { text: 'Я у Экспо' }, name: 'resolve_location' });

		expect(result.status).toBe('error');
		expect(deps.readPlaces).not.toHaveBeenCalled();
	});

	it('rejects recommendations fabricated by a ranking dependency', async () => {
		const { ctx, deps } = fixture();
		vi.mocked(deps.rankPlaces).mockReturnValue([{ ...candidate, place: { ...place, name: 'Выдуманное место' } }]);
		await expect(findPlaces(ctx, { query: 'музей' })).rejects.toMatchObject({ constraint: 'invalid_place_results' });
	});

	it('rejects a route whose stated total hides time needed for visits', async () => {
		const { ctx, deps } = fixture();
		vi.mocked(deps.planWalk).mockReturnValue({
			legs: [{ distanceM: 100, from: ctx.browserLocation!, to: place, walkMinutes: 2 }],
			note: '',
			stops: [{ arriveAtMinute: 2, candidate, order: 1 }],
			totalMinutes: 8,
		});
		await expect(planWalk(ctx, { durationMinutes: 20, start: ctx.browserLocation! })).rejects.toMatchObject({
			constraint: 'invalid_walk_plan',
		});
	});

	it('accepts a route whose stops and timing match the search result', async () => {
		const { ctx, deps } = fixture();
		vi.mocked(deps.planWalk).mockReturnValue({
			legs: [{ distanceM: 100, from: ctx.browserLocation!, to: place, walkMinutes: 2 }],
			note: 'По прямой ×1,3',
			stops: [{ arriveAtMinute: 2, candidate, order: 1 }],
			totalMinutes: 32,
		});
		expect((await planWalk(ctx, { durationMinutes: 60, start: ctx.browserLocation! })).totalMinutes).toBe(32);
	});

	it('rejects missing location before attempting to read data', async () => {
		const { ctx, deps } = fixture();
		ctx.browserLocation = undefined;
		await expect(findPlaces(ctx, { query: 'кофе' })).rejects.toMatchObject({ constraint: 'location_required' });
		expect(deps.readPlaces).not.toHaveBeenCalled();
	});
	it('rejects an invented near point and route start', async () => {
		const { ctx } = fixture();
		await expect(findPlaces(ctx, { near: { lat: 0, lon: 0 }, query: 'кофе' })).rejects.toMatchObject({
			constraint: 'location_mismatch',
		});
		await expect(planWalk(ctx, { durationMinutes: 60, start: { lat: 0, lon: 0 } })).rejects.toMatchObject({
			constraint: 'location_mismatch',
		});
	});
	it('passes validated filters, lexical scores and injected time to ranking', async () => {
		const { ctx, deps } = fixture();
		ctx.browserLocation = { lat: 51.123456, lon: 71.456789 };
		const result = await findPlaces(ctx, { accessibleOnly: true, categories: ['museum'], query: 'музей' });

		expect(result.origin).toEqual({ label: null, point: { lat: 51.123, lon: 71.457 }, source: 'browser' });
		expect(deps.rankPlaces).toHaveBeenCalledWith(
			expect.objectContaining({
				accessibleOnly: true,
				at: ctx.now,
				categories: ['museum'],
				limit: 5,
				maxWalkMinutes: 15,
			}),
		);
		expect(result.note).toContain('лексический');
		expect(deps.readVectors).not.toHaveBeenCalled();
	});
	it('interprets an explicit offset as an instant', async () => {
		const { ctx, deps } = fixture();
		await findPlaces(ctx, { at: '2026-10-19T18:00:00+05:00', query: 'музей' });
		expect(deps.rankPlaces).toHaveBeenCalledWith(expect.objectContaining({ at: new Date('2026-10-19T13:00:00Z') }));
	});
	it('resolves aliases using dataset coordinates without guessing ambiguous places', () => {
		const { ctx, deps } = fixture();
		expect(resolveLocation(ctx, { text: 'Я у Нур Алем' })).toMatchObject({
			found: true,
			matchedPlaceId: place.id,
			point: { lat: 51.123, lon: 71.457 },
		});
		vi.mocked(deps.readPlaces).mockReturnValue([
			{ ...place, id: 'osm:node/2', name: 'Кофейня' },
			{ ...place, id: 'osm:node/3', name: 'Кофейня' },
		]);
		expect(resolveLocation(ctx, { text: 'Я у Кофейни Кофейня' }).found).toBe(false);
		expect(resolveLocation(ctx, { text: 'Я у Нур Алем' }).found).toBe(false);
	});
	it('only returns a requested POI that exists in the dataset', () => {
		const { ctx } = fixture();
		expect(getPlace(ctx, { id: place.id })).toEqual(place);
		expect(() => getPlace(ctx, { id: 'osm:node/999' })).toThrow();
	});
	it('rejects an algorithm result exceeding the time budget', async () => {
		const { ctx, deps } = fixture();
		vi.mocked(deps.planWalk).mockReturnValue({ legs: [], note: '', stops: [], totalMinutes: 61 });
		await expect(planWalk(ctx, { durationMinutes: 60, start: ctx.browserLocation! })).rejects.toMatchObject({
			constraint: 'invalid_walk_plan',
		});
	});
	it('returns a visible error when reading the dataset fails', async () => {
		const { ctx, deps } = fixture();
		vi.mocked(deps.readPlaces).mockImplementation(() => {
			throw new Error('Dataset unavailable');
		});
		const result = await executeTool(ctx, { args: { query: 'музей' }, name: 'find_places' });
		expect(result.status).toBe('error');
		expect(typeof result.result).toBe('string');
		expect(result.result).not.toContain('Dataset unavailable');
	});
});

describe('mock scenarios use the real dispatcher', () => {
	it.each([
		'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком',
		'Я возле Mega Silk Way, хочу прогуляться 30–60 минут',
		'Хочу тихое место с кофе и розеткой недалеко от меня',
		'Еду с ребёнком — где рядом детские площадки или музей с интерактивами?',
		'Я турист, у меня 2 часа перед вылетом',
		'Ищу необычную ночную активность на последние пару часов',
	])('searches with browser location: %s', async (content) => {
		const { ctx } = fixture();
		const result = await runAgent(ctx, { location: ctx.browserLocation, messages: [{ content, role: 'user' }] });
		expect(result.toolCalls.map((call) => call.name)).toContain('find_places');
		expect(result.reply).toContain('геолокация браузера');
		expect(result.reply).not.toContain('открыто по данным');
	});
	it('resolves a landmark from actual user text and reports the text source', async () => {
		const { ctx } = fixture();
		const result = await runAgent(ctx, {
			messages: [{ content: 'Я у Нур Алем, хочу что-то необычное', role: 'user' }],
		});
		expect(result.toolCalls.map((call) => call.name)).toEqual(['resolve_location', 'find_places']);
		expect(result.reply).toContain('из ваших слов');
		expect(ctx.resolvedLocation).toBeUndefined();
	});
	it('asks for missing location instead of choosing a landmark', async () => {
		const { ctx, deps } = fixture();
		const result = await runAgent(ctx, {
			messages: [{ content: 'Еду с ребёнком — где рядом площадка?', role: 'user' }],
		});
		expect(result.reply).toContain('Где вы');
		expect(result.toolCalls).toEqual([]);
		expect(deps.readPlaces).not.toHaveBeenCalled();
	});
	it('does not spend the entire pre-flight budget on a walking route', async () => {
		const { ctx, deps } = fixture();
		const result = await runAgent(ctx, {
			location: ctx.browserLocation,
			messages: [{ content: 'Построй маршрут на 2 часа перед вылетом', role: 'user' }],
		});
		expect(result.reply).toContain('досмотра');
		expect(deps.planWalk).not.toHaveBeenCalled();
	});
});
