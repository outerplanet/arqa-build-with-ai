import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walkingGraphSchema } from '../model/walkingGraph.schema';

const fixture = {
	bbox: [51.03, 71.25, 51.25, 71.65],
	collectedAt: '2026-10-19T12:00:00Z',
	edges: [
		[0, 1, 42],
		[1, 0, 42],
	],
	nodes: [
		[1, 51.1, 71.4],
		[2, 51.101, 71.4],
	],
	source: 'OpenStreetMap',
	version: 1,
};

describe('optional validated walking graph', () => {
	afterEach(() => {
		vi.doUnmock('node:fs');
		vi.resetModules();
	});
	async function load(text: string | null) {
		vi.resetModules();
		vi.doMock('node:fs', () => ({
			readFileSync: vi.fn(() => {
				if (text === null) throw new Error('Missing');
				return text;
			}),
		}));
		return import('./walkingGraph');
	}
	it('caches the validated public graph without rereading', async () => {
		const repo = await load(JSON.stringify(fixture));
		expect(repo.readWalkingGraph()).toEqual(fixture);
		expect(repo.readWalkingGraph()).toBe(repo.readWalkingGraph());
		const fs = await import('node:fs');
		expect(fs.readFileSync).toHaveBeenCalledTimes(1);
	});
	it.each([
		null,
		'{}',
		'not JSON',
		JSON.stringify({ ...fixture, edges: [[0, 99, 42]] }),
		JSON.stringify({
			...fixture,
			nodes: [
				[1, 51.1, 71.4],
				[1, 51.2, 71.4],
			],
		}),
		JSON.stringify({ ...fixture, edges: [] }),
	])('returns unavailable for missing or invalid graphs: %s', async (text) => {
		const repo = await load(text);
		expect(repo.readWalkingGraph()).toBeNull();
	});
	it('rejects self loops, duplicate edges, bad coordinates, bbox and timestamps', () => {
		for (const bad of [
			{ ...fixture, edges: [[0, 0, 42]] },
			{
				...fixture,
				edges: [
					[0, 1, 42],
					[0, 1, 42],
				],
			},
			{
				...fixture,
				nodes: [
					[1, 200, 71.4],
					[2, 51.1, 71.4],
				],
			},
			{ ...fixture, bbox: [52, 71, 51, 72] },
			{ ...fixture, collectedAt: 'today' },
		])
			expect(walkingGraphSchema.safeParse(bad).success).toBe(false);
	});
	it('ships a nonempty validated graph with source metadata', () => {
		const graph = walkingGraphSchema.parse(JSON.parse(readFileSync('data/walking-graph.json', 'utf8')) as unknown);
		expect(graph.edges.length).toBeGreaterThan(100);
		expect(new Set(graph.edges.map((edge) => edge[2])).size).toBeGreaterThan(10);
	});
});
