import { runAgent } from '@server/agent/usecase/agent';
import { resetEnvCache } from '@server/kernel/env';
import { findPlacesResultSchema, walkPlanSchema } from '@server/places/model/places.schema';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPlaces } from './findPlaces';
import { planWalk } from './planWalk';

const point = { lat: 51.1, lon: 71.4 };
const ctx = { browserLocation: point, now: new Date('2026-10-19T10:00:00Z') };

beforeEach(() => {
	vi.stubEnv('LLM_PROVIDER', 'mock');
	vi.stubEnv('EMBEDDING_PROVIDER', 'lexical');
	resetEnvCache();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('real data and algorithm integration without an API key', () => {
	it('returns nearby cafes using actual dataset records and opening-hours calculations', async () => {
		const result = await findPlaces(ctx, { categories: ['cafe'], query: 'кофе' });

		expect(result.candidates.length).toBeGreaterThan(0);
		expect(
			result.candidates.every((candidate) => candidate.place.category === 'cafe' && candidate.walkMinutes <= 15),
		).toBe(true);
		expect(result.note).toContain('лексический');
		expect(result.origin).toEqual({ label: null, point, source: 'browser' });
	});

	it('builds an actual two-stop route whose walking and visiting time fits the budget', async () => {
		const result = await planWalk(ctx, { durationMinutes: 120, query: 'кофе', start: point });

		expect(result.stops.length).toBeGreaterThanOrEqual(2);
		expect(result.totalMinutes).toBeLessThanOrEqual(120);
		expect(
			result.legs.reduce((sum, leg) => sum + leg.walkMinutes, 0) +
				result.stops.reduce((sum, stop) => sum + stop.candidate.visitMinutes, 0),
		).toBe(result.totalMinutes);
	});

	it('sends dataset-backed results through the real mock dispatcher', async () => {
		const result = await runAgent(ctx, {
			location: point,
			messages: [{ content: 'Хочу кофе недалеко от меня на час', role: 'user' }],
		});
		const search = findPlacesResultSchema.parse(result.toolCalls.find((call) => call.name === 'find_places')?.result);

		expect(search.candidates.length).toBeGreaterThan(0);
		expect(result.reply).toContain('OpenStreetMap');
		expect(result.reply).toContain('геолокация браузера');
		expect(result.toolCalls.every((call) => call.status === 'ok')).toBe(true);
	});

	it('executes a route request through both search and planner tools', async () => {
		const result = await runAgent(ctx, {
			location: point,
			messages: [{ content: 'Построй маршрут на 2 часа', role: 'user' }],
		});
		const route = walkPlanSchema.parse(result.toolCalls.find((call) => call.name === 'plan_walk')?.result);

		expect(result.toolCalls.map((call) => call.name)).toEqual(['find_places', 'plan_walk']);
		expect(route.totalMinutes).toBeLessThanOrEqual(120);
	});
});
