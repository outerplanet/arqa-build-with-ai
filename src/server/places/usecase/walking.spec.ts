import { type GeoPoint, type WalkPlan } from '@server/places/model/places.schema';
import { type WalkingGraphData } from '@server/places/model/walkingGraph.schema';
import 'server-only';
import { describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { type PlacesDependencies } from './dependencies';
import { walkingCalculator } from './walking';

const data: WalkingGraphData = {
	bbox: [51, 71, 52, 72],
	collectedAt: '2026-10-19T10:00:00Z',
	edges: [
		[0, 1, 1],
		[1, 0, 1],
		[1, 2, 1],
		[2, 1, 1],
		[2, 3, 1],
		[3, 2, 1],
	],
	nodes: [
		[1, 51.128, 71.43],
		[2, 51.129, 71.43],
		[3, 51.129, 71.432],
		[4, 51.128, 71.432],
	],
	source: 'OpenStreetMap',
	version: 1,
};
function context(readWalkingGraph?: PlacesDependencies['readWalkingGraph']): PlacesContext {
	return {
		now: new Date('2026-10-19T10:00:00Z'),
		places: {
			getPlaceById: vi.fn(),
			lexicalScores: vi.fn(),
			planWalk: vi.fn(),
			rankPlaces: vi.fn(),
			readPlaces: vi.fn(),
			readVectors: vi.fn(),
			readWalkingGraph,
		},
	};
}
const from: GeoPoint = { lat: 51.128, lon: 71.43 };
const to: GeoPoint = { lat: 51.128, lon: 71.432 };

describe('request-scoped walking calculation', () => {
	it('uses graph distance and speed once, with visits included in the budget', () => {
		const calculator = walkingCalculator(context(() => data))!;
		const measured = calculator.measureLeg(from, to)!;
		expect(measured.distanceM).toBeGreaterThan(300);
		expect(measured.walkMinutes).toBe(Math.ceil(measured.distanceM / 75));
		const plan = {
			legs: [{ from, to, ...measured }],
			stops: [{ candidate: { place: { id: 'osm:node/4' } } }],
			totalMinutes: measured.walkMinutes + 10,
		} as WalkPlan;
		const route = calculator.routeFor(plan);
		expect(route.status).toBe('available');
		if (route.status === 'available') {
			expect(route.totalMinutes).toBe(plan.totalMinutes);
			expect(route.legs[0]!.geometry.coordinates).toEqual([
				[71.43, 51.128],
				[71.43, 51.129],
				[71.432, 51.129],
				[71.432, 51.128],
			]);
		}
	});
	it('returns no calculator when graph loading is absent, missing or fails', () => {
		for (const loader of [
			undefined,
			() => null,
			() => {
				throw new Error('Unavailable');
			},
		])
			expect(walkingCalculator(context(loader))).toBeNull();
	});
	it('does not substitute a straight line outside graph coverage', () => {
		const calculator = walkingCalculator(context(() => data))!;
		expect(calculator.measureLeg(from, { lat: 52, lon: 72 })).toBeNull();
		expect(calculator.routeFor({ legs: [], note: '', stops: [], totalMinutes: 0 }).status).toBe('unavailable');
	});
});
