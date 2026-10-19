import { describe, expect, it } from 'vitest';
import { type ScreenPoint, spreadMarkers } from './spreadMarkers';

function placed(points: readonly ScreenPoint[], minDistance: number) {
	const offsets = spreadMarkers(points, minDistance);
	return points.map((point) => {
		const offset = offsets.get(point.id) ?? { dx: 0, dy: 0 };
		return { x: point.x + offset.dx, y: point.y + offset.dy };
	});
}

function minGap(points: readonly { x: number; y: number }[]) {
	let gap = Number.POSITIVE_INFINITY;
	for (const [a, left] of points.entries()) {
		for (const right of points.slice(a + 1)) gap = Math.min(gap, Math.hypot(left.x - right.x, left.y - right.y));
	}
	return gap;
}

describe('spreadMarkers', () => {
	it('leaves markers that do not touch where they are', () => {
		const offsets = spreadMarkers(
			[
				{ id: 'a', x: 0, y: 0 },
				{ id: 'b', x: 100, y: 0 },
			],
			40,
		);
		expect(offsets.get('a')).toEqual({ dx: 0, dy: 0 });
		expect(offsets.get('b')).toEqual({ dx: 0, dy: 0 });
	});

	it('pulls two markers 9 px apart (the Expo defect) at least a marker width apart', () => {
		const points = [
			{ id: '1', x: 200, y: 150 },
			{ id: '2', x: 209, y: 150 },
		];
		const result = placed(points, 40);
		expect(minGap(result)).toBeGreaterThanOrEqual(40 - 1e-9);
		// The spread is symmetric around the shared centre, so neither marker wanders off.
		expect((result[0]!.x + result[1]!.x) / 2).toBeCloseTo(204.5);
		// The original left-right order is kept.
		expect(result[0]!.x).toBeLessThan(result[1]!.x);
	});

	it('fans out identical positions deterministically', () => {
		const points = [
			{ id: 'start', x: 50, y: 50 },
			{ id: 'p1', x: 50, y: 50 },
			{ id: 'p2', x: 50, y: 50 },
		];
		const first = placed(points, 36);
		expect(minGap(first)).toBeGreaterThanOrEqual(36 - 1e-9);
		expect(placed(points, 36)).toEqual(first);
	});

	it('spreads a chain of near markers and leaves a far one alone', () => {
		const points = [
			{ id: 'a', x: 0, y: 0 },
			{ id: 'b', x: 20, y: 0 },
			{ id: 'c', x: 40, y: 0 },
			{ id: 'far', x: 400, y: 400 },
		];
		const offsets = spreadMarkers(points, 30);
		expect(offsets.get('far')).toEqual({ dx: 0, dy: 0 });
		expect(minGap(placed(points, 30).slice(0, 3))).toBeGreaterThanOrEqual(30 - 1e-9);
	});

	it('returns an empty layout for no markers', () => {
		expect(spreadMarkers([], 40).size).toBe(0);
	});
});
