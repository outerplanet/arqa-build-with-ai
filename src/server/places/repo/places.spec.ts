import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getPlaceById, readPlaces } from './places';

describe('collected places', () => {
	it('loads a validated nonempty dataset with unique OSM ids and caches it', () => {
		const places = readPlaces();
		expect(places.length).toBeGreaterThan(0);
		expect(new Set(places.map((place) => place.id)).size).toBe(places.length);
		expect(readPlaces()).toBe(places);
	});
	it('finds a collected object and returns null for an unknown id', () => {
		const first = readPlaces()[0];
		expect(first).toBeDefined();
		if (first === undefined) throw new Error('Missing collected POI');
		expect(getPlaceById(first.id)).toEqual(first);
		expect(getPlaceById('osm:node/0')).toBeNull();
	});
	it('recomputes summary coverage and category totals from the collected rows', () => {
		const coverageSchema = z.object({ count: z.number(), fraction: z.number(), percent: z.number() });
		const summary = z
			.object({
				byCategory: z.record(z.string(), z.number()),
				collectedAt: z.iso.datetime(),
				descriptions: coverageSchema,
				openingHours: coverageSchema,
				total: z.number(),
				wikidataDescriptions: coverageSchema,
				wikidataPopularity: coverageSchema,
			})
			.parse(JSON.parse(readFileSync('data/collect_summary.json', 'utf8')) as unknown);
		const places = readPlaces();
		expect(summary.total).toBe(places.length);
		expect(Object.values(summary.byCategory).reduce((sum, count) => sum + count, 0)).toBe(places.length);
		for (const [category, count] of Object.entries(summary.byCategory)) {
			expect(count).toBe(places.filter((place) => place.category === category).length);
		}
		const metrics = [
			[summary.openingHours, places.filter((place) => place.openingHours !== null).length],
			[summary.descriptions, places.filter((place) => place.description !== null).length],
			[summary.wikidataDescriptions, places.filter((place) => place.descriptionSource === 'wikidata').length],
			[summary.wikidataPopularity, places.filter((place) => place.popularity !== null).length],
		] as const;
		for (const [metric, count] of metrics) {
			expect(metric.count).toBe(count);
			expect(metric.fraction).toBeCloseTo(count / places.length);
			expect(metric.percent).toBe(Math.round((count / places.length) * 10000) / 100);
		}
	});
});
