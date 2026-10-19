import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getPlaceById, readPlaces } from './places';

describe('collected places', () => {
	it('ships 15 genuine validated sample rows copied from the collected dataset', () => {
		const sample = JSON.parse(readFileSync('data/poi.sample.json', 'utf8')) as { id: string }[];
		expect(sample).toHaveLength(15);
		expect(new Set(sample.map((place) => place.id)).size).toBe(15);
		for (const place of sample) expect(getPlaceById(place.id)).toEqual(place);
	});
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

describe('dataset selection and validation', () => {
	afterEach(() => {
		vi.doUnmock('node:fs');
		vi.resetModules();
	});
	async function load(files: Record<string, string>) {
		vi.resetModules();
		vi.doMock('node:fs', () => ({
			existsSync: (path: string) => Object.keys(files).some((name) => path.endsWith(name)),
			readFileSync: (path: string) => {
				const key = Object.keys(files).find((name) => path.endsWith(name));
				if (key === undefined) throw new Error('Unexpected read');
				return files[key];
			},
		}));
		return import('./places');
	}
	it('uses the sample only when the primary dataset is missing and caches the result', async () => {
		const row = readPlaces()[0];
		const repo = await load({ 'poi.sample.json': JSON.stringify([row]) });
		expect(repo.readPlaces()).toEqual([row]);
		expect(repo.readPlaces()).toBe(repo.readPlaces());
	});
	it('reports a missing primary and sample with recovery instructions', async () => {
		const repo = await load({});
		expect(() => repo.readPlaces()).toThrow('pnpm collect');
	});
	it.each(['[]', '[{}]', 'not json'])(
		'rejects a broken primary without silently loading the sample: %s',
		async (primary) => {
			const repo = await load({ 'poi.json': primary, 'poi.sample.json': JSON.stringify([readPlaces()[0]]) });
			expect(() => repo.readPlaces()).toThrow();
		},
	);
	it('rejects repeated OSM ids even when both rows are valid', async () => {
		const row = readPlaces()[0];
		const repo = await load({ 'poi.json': JSON.stringify([row, row]) });
		expect(() => repo.readPlaces()).toThrow('Duplicate POI ids');
	});
});
