import { runAgent } from '@server/agent/usecase/agent';
import { resetEnvCache } from '@server/kernel/env';
import { findPlacesResultSchema, walkPlanSchema } from '@server/places/model/places.schema';
import { readPlaces } from '@server/places/repo/places';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placesDependencies } from './dependencies';
import { resolveLocation } from './resolveLocation';

beforeEach(() => {
	vi.stubEnv('LLM_PROVIDER', 'mock');
	resetEnvCache();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('committed dataset integration without injected dependencies', () => {
	it.each(['Я между Нур Алем и AITU', 'Я на станции Байтерек'])(
		'does not replace conflicting or typed locations with an anchor: %s',
		(text) => {
			expect(resolveLocation({ now: new Date('2026-10-19T08:00:00Z') }, { text }).found).toBe(false);
		},
	);
	it('honours an explicitly named full POI instead of its nested Expo alias', () => {
		expect(resolveLocation({ now: new Date('2026-10-19T08:00:00Z') }, { text: 'Я у Астана-Экспо КС' })).toMatchObject(
			{
				found: true,
				matchedPlaceId: 'osm:node/2388707906',
			},
		);
	});
	it('asks rather than choosing between two different landmarks', () => {
		expect(
			resolveLocation(
				{ now: new Date('2026-10-19T08:00:00Z') },
				{
					text: 'Я между Нур Алем и Хан Шатыр',
				},
			).found,
		).toBe(false);
	});
	it('cannot supply coordinates for a canonical landmark missing from the collection', () => {
		expect(
			resolveLocation(
				{
					now: new Date('2026-10-19T08:00:00Z'),
					places: { ...placesDependencies, readPlaces: () => [] },
				},
				{ text: 'Я у Нур Алем' },
			),
		).toMatchObject({ found: false, point: null });
	});
	it.each([
		['Я у здания Экспо 2017', 'osm:way/454853233'],
		['Я в квартале Экспо', 'osm:way/1456208623'],
		['Я у Нур Алем', 'osm:way/454857501'],
		['Я у Нуралема', 'osm:way/454857501'],
		['Я у Alem.ai', 'osm:way/454857501'],
		['Я у Байтерека', 'osm:way/230401645'],
		['Я возле Хан Шатыра', 'osm:way/460703779'],
		['Я возле Mega Silk Way', 'osm:way/499328514'],
	])('resolves %s to public source coordinates', (text, id) => {
		const place = readPlaces().find((row) => row.id === id)!;
		expect(place).toBeDefined();
		expect(resolveLocation({ now: new Date('2026-10-19T08:00:00Z') }, { text })).toMatchObject({
			found: true,
			matchedPlaceId: id,
			point: { lat: Math.round(place.lat * 1000) / 1000, lon: Math.round(place.lon * 1000) / 1000 },
		});
	});
	it('searches real data and constructs a timed route through the normal mock dispatcher', async () => {
		const result = await runAgent(
			{ now: new Date('2026-10-19T08:00:00Z') },
			{ messages: [{ content: 'Я у Нур Алем. Построй маршрут на 90 минут', role: 'user' }] },
		);
		expect(result.toolCalls.map((call) => [call.name, call.status])).toEqual([
			['resolve_location', 'ok'],
			['find_places', 'ok'],
			['plan_walk', 'ok'],
		]);
		const found = findPlacesResultSchema.parse(result.toolCalls[1]!.result);
		expect(found.candidates.length).toBeGreaterThan(0);
		const ids = new Set(readPlaces().map((place) => place.id));
		expect(found.candidates.every((candidate) => ids.has(candidate.place.id))).toBe(true);
		const route = walkPlanSchema.parse(result.toolCalls[2]!.result);
		expect(route.stops.length).toBeGreaterThanOrEqual(2);
		expect(route.totalMinutes).toBeGreaterThan(0);
		expect(route.totalMinutes).toBeLessThanOrEqual(90);
		expect(result.reply).toContain('OpenStreetMap');
	});
});
