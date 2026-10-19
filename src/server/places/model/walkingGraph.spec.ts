import 'server-only';
import { describe, expect, it } from 'vitest';
import { distanceM } from './geo';
import { type GeoPoint } from './places.schema';
import { createWalkingGraph, findWalkingPath, type WalkingGraphInput } from './walkingGraph';

function graph(points: readonly GeoPoint[], directed: readonly (readonly [number, number])[]) {
	return createWalkingGraph({
		edges: directed.map(([from, to]) => [from, to, 100]),
		nodes: points.map(({ lat, lon }, index) => [index + 1, lat, lon]),
	});
}
const a = { lat: 51, lon: 71 };
const b = { lat: 51, lon: 71.01 };
const middle = { lat: 51, lon: 71.005 };

describe('walking graph paths', () => {
	it('matches an independent all-pairs distance oracle on a directed graph', () => {
		const points = Array.from({ length: 8 }, (_, index) => ({
			lat: 51 + Math.sin((index * Math.PI) / 4) * 0.002,
			lon: 71 + Math.cos((index * Math.PI) / 4) * 0.003,
		}));
		const edges: [number, number][] = [
			[0, 1],
			[1, 2],
			[2, 3],
			[3, 4],
			[4, 5],
			[5, 6],
			[6, 7],
			[0, 4],
			[1, 5],
			[5, 2],
			[7, 3],
		];
		const distances = points.map((_, from) => points.map((__, to) => (from === to ? 0 : Infinity)));
		for (const [from, to] of edges) distances[from]![to] = distanceM(points[from]!, points[to]!);
		for (let via = 0; via < points.length; via++) {
			for (let from = 0; from < points.length; from++) {
				for (let to = 0; to < points.length; to++) {
					distances[from]![to] = Math.min(distances[from]![to]!, distances[from]![via]! + distances[via]![to]!);
				}
			}
		}
		const index = graph(points, edges);
		for (const [from, start] of points.entries()) {
			for (const [to, finish] of points.entries()) {
				const path = findWalkingPath(index, { from: start, to: finish });
				if (Number.isFinite(distances[from]![to])) expect(path?.distanceM).toBeCloseTo(distances[from]![to]!, 6);
				else expect(path).toBeNull();
			}
		}
	});
	it('follows a U-shaped obstacle detour instead of connecting endpoints through a building', () => {
		const points = [a, { lat: 51.002, lon: 71 }, { lat: 51.002, lon: 71.002 }, { lat: 51, lon: 71.002 }];
		const index = graph(points, [
			[0, 1],
			[1, 2],
			[2, 3],
			[1, 0],
			[2, 1],
			[3, 2],
		]);
		const path = findWalkingPath(index, { from: points[0]!, to: points[3]! });
		expect(path?.coordinates).toEqual(points.map(({ lat, lon }) => [lon, lat]));
		expect(path!.distanceM).toBeGreaterThan(distanceM(points[0]!, points[3]!) * 3);
	});
	it('never merges intersecting ways without a common OSM node', () => {
		const index = graph(
			[
				{ lat: 51, lon: 71 },
				{ lat: 51, lon: 71.004 },
				{ lat: 50.998, lon: 71.002 },
				{ lat: 51.002, lon: 71.002 },
			],
			[
				[0, 1],
				[1, 0],
				[2, 3],
				[3, 2],
			],
		);
		expect(findWalkingPath(index, { from: a, to: { lat: 51.002, lon: 71.002 } })).toBeNull();
	});
	it('does not connect coincident nodes with different OSM identities', () => {
		const index = graph(
			[a, middle, middle, b],
			[
				[0, 1],
				[1, 0],
				[2, 3],
				[3, 2],
			],
		);
		expect(findWalkingPath(index, { from: a, to: b })).toBeNull();
	});
	it('snaps to the middle of an edge even when both vertices are far away', () => {
		const index = graph(
			[a, b],
			[
				[0, 1],
				[1, 0],
			],
		);
		const from = { lat: 51.0002, lon: 71.004 };
		const to = { lat: 51.0002, lon: 71.006 };
		const path = findWalkingPath(index, { from, to });
		expect(path?.coordinates).toEqual([
			[71.004, 51],
			[71.006, 51],
		]);
		expect(path?.fromSnap.offsetM).toBeGreaterThan(20);
		expect(path?.fromSnap.offsetM).toBeLessThan(23);
		expect(path!.distanceM).toBeCloseTo(distanceM({ ...from, lat: 51 }, { ...to, lat: 51 }), 5);
	});
	it('supports same-edge travel only in permitted directions', () => {
		const index = graph([a, b], [[0, 1]]);
		const from = { ...a, lon: 71.002 };
		const to = { ...a, lon: 71.008 };
		expect(findWalkingPath(index, { from, to })?.coordinates).toEqual([
			[71.002, 51],
			[71.008, 51],
		]);
		expect(findWalkingPath(index, { from: to, to: from })).toBeNull();
		expect(
			findWalkingPath(
				graph(
					[a, b],
					[
						[0, 1],
						[1, 0],
					],
				),
				{ from: to, to: from },
			)?.coordinates,
		).toEqual([
			[71.008, 51],
			[71.002, 51],
		]);
	});
	it('can travel backward to the same edge only through a real directed cycle', () => {
		const corner = { lat: 51.002, lon: 71 };
		const index = graph(
			[a, b, corner],
			[
				[0, 1],
				[1, 2],
				[2, 0],
			],
		);
		const path = findWalkingPath(index, { from: { ...a, lon: 71.008 }, to: { ...a, lon: 71.002 } });
		expect(path?.coordinates).toEqual([
			[71.008, 51],
			[71.01, 51],
			[71, 51.002],
			[71, 51],
			[71.002, 51],
		]);
	});
	it('clamps projection to an endpoint and omits the original off-graph connectors', () => {
		const from = { lat: 51, lon: 70.9998 };
		const path = findWalkingPath(graph([a, b], [[0, 1]]), { from, to: b });
		expect(path?.fromSnap.point).toEqual(a);
		expect(path?.coordinates).toEqual([
			[71, 51],
			[71.01, 51],
		]);
	});
	it('rejects far snaps, disconnected components and invalid positions', () => {
		const index = graph(
			[a, b],
			[
				[0, 1],
				[1, 0],
			],
		);
		expect(findWalkingPath(index, { from: { lat: 51.001, lon: 71.005 }, to: b })).toBeNull();
		expect(findWalkingPath(index, { from: middle, maxSnapM: 0, to: b })).not.toBeNull();
		for (const maxSnapM of [NaN, Infinity, -1])
			expect(findWalkingPath(index, { from: a, maxSnapM, to: b })).toBeNull();
		for (const from of [
			{ lat: NaN, lon: 71 },
			{ lat: 51, lon: Infinity },
			{ lat: 91, lon: 71 },
		]) {
			expect(findWalkingPath(index, { from, to: b })).toBeNull();
		}
		expect(findWalkingPath(graph([], []), { from: a, to: b })).toBeNull();
	});
	it('ignores zero-length edges without merging their nodes or creating time', () => {
		const index = graph(
			[a, a, b],
			[
				[0, 0],
				[0, 1],
				[1, 0],
				[1, 2],
			],
		);
		const path = findWalkingPath(index, { from: a, to: b });
		expect(path?.coordinates).toEqual([
			[71, 51],
			[71.01, 51],
		]);
		expect(Number.isFinite(path?.distanceM)).toBe(true);
		expect(findWalkingPath(index, { from: middle, to: middle })?.coordinates).toEqual([
			[71.005, 51],
			[71.005, 51],
		]);
	});
	it('chooses the shortest real path and leaves the index usable across requests', () => {
		const points = [a, { lat: 51.001, lon: 71.002 }, { lat: 51.003, lon: 71.002 }, { lat: 51, lon: 71.004 }];
		const index = graph(points, [
			[0, 2],
			[2, 3],
			[0, 1],
			[1, 3],
		]);
		const first = findWalkingPath(index, { from: points[0]!, to: points[3]! });
		expect(first?.coordinates).toEqual([points[0], points[1], points[3]].map((point) => [point!.lon, point!.lat]));
		expect(findWalkingPath(index, { from: points[3]!, to: points[0]! })).toBeNull();
		expect(findWalkingPath(index, { from: points[0]!, to: points[3]! })).toEqual(first);
	});
	it('rejects malformed graph inputs before a query can observe them', () => {
		const valid: WalkingGraphInput = {
			edges: [[0, 1, 100]],
			nodes: [
				[1, 51, 71],
				[2, 51, 71.01],
			],
		};
		for (const input of [
			{ ...valid, nodes: [[1, NaN, 71]] },
			{ ...valid, nodes: [[1, 91, 71]] },
			{
				...valid,
				nodes: [
					[1, 51, 71],
					[1, 51, 72],
				],
			},
			{ ...valid, edges: [[-1, 1, 100]] },
			{ ...valid, edges: [[0, 2, 100]] },
			{ ...valid, edges: [[0.5, 1, 100]] },
			{ ...valid, edges: [[0, 1, NaN]] },
		])
			expect(() => createWalkingGraph(input as WalkingGraphInput)).toThrow();
	});
});
