import {
	findPlacesInputSchema,
	geoPointSchema,
	getPlaceInputSchema,
	openStatusSchema,
	placeSchema,
	planWalkInputSchema,
	resolvedLocationSchema,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const POINT = { lat: 51.1, lon: 71.4 };

describe('the shared places contract', () => {
	it('applies search defaults without inventing a location or time', () => {
		expect(findPlacesInputSchema.parse({ query: '  кофе  ' })).toEqual({
			limit: 5,
			maxWalkMinutes: 15,
			query: 'кофе',
		});
	});

	it.each([
		{ lat: 91, lon: 71 },
		{ lat: 51, lon: -181 },
		{ lat: '51', lon: 71 },
		{ lat: NaN, lon: 71 },
		{ lat: 51, lon: Infinity },
	])('rejects invalid coordinates: %j', (point) => {
		expect(geoPointSchema.safeParse(point).success).toBe(false);
	});

	it.each([
		{ query: ' ' },
		{ limit: 0 },
		{ limit: 11 },
		{ limit: 1.5 },
		{ maxWalkMinutes: 4 },
		{ maxWalkMinutes: 91 },
		{ categories: ['invented'] },
		{ accessibleOnly: 'false' },
		{ at: '2026-10-19T12:00:00' },
		{ at: '2026-02-30T12:00:00Z' },
	])('rejects invalid tool arguments: %j', (overrides) => {
		expect(findPlacesInputSchema.safeParse({ query: 'кофе', ...overrides }).success).toBe(false);
	});

	it('accepts instants with a timezone offset and boundary values', () => {
		expect(
			findPlacesInputSchema.safeParse({
				at: '2026-10-19T12:00:00+05:00',
				limit: 10,
				maxWalkMinutes: 90,
				near: POINT,
				query: 'парк',
			}).success,
		).toBe(true);
	});

	it('keeps missing POI information explicitly null', () => {
		const place = {
			...POINT,
			address: null,
			category: 'park',
			description: null,
			descriptionSource: null,
			id: 'osm:way/123',
			name: 'Тестовый парк',
			nameEn: null,
			openingHours: null,
			phone: null,
			popularity: null,
			sourceUrl: 'https://www.openstreetmap.org/way/123',
			tags: [],
			website: null,
			wheelchair: null,
		};

		expect(placeSchema.parse(place)).toEqual(place);
		expect(placeSchema.safeParse({ ...place, openingHours: undefined }).success).toBe(false);
		expect(placeSchema.safeParse({ ...place, popularity: 1.01 }).success).toBe(false);
	});

	it('represents unknown opening hours without fabricated times', () => {
		expect(
			openStatusSchema.safeParse({
				confidence: 'none',
				note: 'Часы работы неизвестны — уточните перед выходом',
				opensAt: null,
				status: 'unknown',
				until: null,
			}).success,
		).toBe(true);
	});

	it('represents unresolved locations and empty routes', () => {
		expect(
			resolvedLocationSchema.safeParse({
				confidence: 'low',
				found: false,
				label: null,
				matchedPlaceId: null,
				point: null,
			}).success,
		).toBe(true);
		expect(
			walkPlanSchema.safeParse({ legs: [], note: 'Нет подходящих мест', stops: [], totalMinutes: 0 }).success,
		).toBe(true);
	});

	it('defaults to three stops and bounds the walk budget', () => {
		expect(planWalkInputSchema.parse({ durationMinutes: 20, start: POINT }).maxStops).toBe(3);
		for (const durationMinutes of [19, 241]) {
			expect(planWalkInputSchema.safeParse({ durationMinutes, start: POINT }).success).toBe(false);
		}
		for (const maxStops of [1, 2.5, 4]) {
			expect(planWalkInputSchema.safeParse({ durationMinutes: 60, maxStops, start: POINT }).success).toBe(false);
		}
	});

	it('accepts all OSM object kinds and rejects unrelated IDs', () => {
		for (const kind of ['node', 'way', 'relation']) {
			expect(getPlaceInputSchema.safeParse({ id: `osm:${kind}/123` }).success).toBe(true);
		}
		expect(getPlaceInputSchema.safeParse({ id: '123' }).success).toBe(false);
	});

	it('can publish tool inputs as JSON Schema', () => {
		for (const schema of [findPlacesInputSchema, planWalkInputSchema, getPlaceInputSchema]) {
			expect(z.toJSONSchema(schema, { io: 'input' }).type).toBe('object');
		}
	});
});
