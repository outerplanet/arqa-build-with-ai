import 'server-only';
import { describe, expect, it } from 'vitest';
import { distanceM, walkMinutes } from './geo';
import { openStatus } from './hours';
import { type Candidate, walkPlanSchema } from './places.schema';
import { planWalk } from './route';

const START = { lat: 51.128, lon: 71.43 };
function candidate(
	id: string,
	...[lon = START.lon, score = 0.5, visitMinutes = 10]: [number?, number?, number?]
): Candidate {
	return {
		distanceM: 0,
		open: openStatus('24/7', new Date('2026-10-19T07:00:00Z')),
		place: {
			...START,
			address: null,
			category: 'cafe',
			description: null,
			descriptionSource: null,
			id,
			lon,
			name: id,
			nameEn: null,
			openingHours: '24/7',
			phone: null,
			popularity: null,
			sourceUrl: 'https://www.openstreetmap.org/node/1',
			tags: [],
			website: null,
			wheelchair: null,
		},
		score,
		visitMinutes,
		walkMinutes: 0,
		why: { distance: 0, open: 1, popularity: 0, semantic: score, tags: [] },
	};
}
function plan(candidates: ReturnType<typeof candidate>[], ...[durationMinutes = 60, maxStops = 3]: [number?, number?]) {
	return planWalk({ candidates, durationMinutes, maxStops, start: START });
}

describe('planWalk', () => {
	it('returns a walk accepted by the shared contract', () => {
		expect(() => walkPlanSchema.parse(plan([candidate('osm:node/1'), candidate('osm:node/2')]))).not.toThrow();
	});
	it('returns an empty route for empty, too short or closed inputs', () => {
		for (const candidates of [[], [candidate('a')], [candidate('a'), candidate('b')]]) {
			const result = plan(candidates, 1);
			expect(result.stops).toEqual([]);
			expect(result.legs).toEqual([]);
			expect(result.totalMinutes).toBe(0);
		}
		const closed = candidate('closed');
		closed.open = openStatus('off', new Date('2026-10-19T07:00:00Z'));
		expect(plan([closed, { ...closed, place: { ...closed.place, id: 'other' } }]).stops).toEqual([]);
		expect(plan([candidate('only')]).stops).toHaveLength(1);
	});

	it('retains unknown hours, accepts an exact budget and caps stops at two or three', () => {
		const unknown = candidate('unknown');
		unknown.open = openStatus(null, new Date('2026-10-19T07:00:00Z'));
		const candidates = [candidate('a'), unknown, candidate('c'), candidate('d')];
		expect(plan(candidates, 20).stops).toHaveLength(2);
		expect(plan(candidates, 20).totalMinutes).toBe(20);
		expect(plan(candidates, 19).stops).toHaveLength(1);
		expect(plan(candidates, 100, 2).stops).toHaveLength(2);
		expect(plan(candidates, 100, 99).stops).toHaveLength(3);
	});

	it('finds the feasible ordering, keeps the start leg and includes visits in arrivals', () => {
		const near = candidate('near', START.lon + 0.002);
		const far = candidate('far', START.lon + 0.01);
		const firstWalk = walkMinutes(distanceM(START, near.place));
		const secondWalk = walkMinutes(distanceM(near.place, far.place));
		const duration = firstWalk + secondWalk + 20;
		const result = plan([far, near], duration);
		expect(result.stops.map((stop) => stop.candidate.place.id)).toEqual(['near', 'far']);
		expect(result.stops.map((stop) => stop.arriveAtMinute)).toEqual([firstWalk, firstWalk + 10 + secondWalk]);
		expect(result.legs[0]!.from).toEqual(START);
		expect(result.legs[0]!.distanceM).toBeCloseTo(distanceM(START, near.place));
		expect(result.legs[0]!.walkMinutes).toBe(firstWalk);
		expect(result.totalMinutes).toBe(duration);
	});

	it('maximizes scores over feasible sets rather than taking the first places', () => {
		const result = plan(
			[candidate('low', START.lon, 0.1), candidate('middle', START.lon, 0.6), candidate('high', START.lon, 0.9)],
			20,
		);
		expect(result.stops.map((stop) => stop.candidate.place.id).sort()).toEqual(['high', 'middle']);
	});
	it('minimizes walking for the same set despite floating-point summation order', () => {
		const result = plan([candidate('a', 71.44, 0.1), candidate('b', 71.435, 0.2), candidate('c', 71.431, 0.3)], 90);
		expect(result.stops.map((stop) => stop.candidate.place.id)).toEqual(['c', 'b', 'a']);
	});

	it('considers only the first twelve and never repeats a place id or mutates input', () => {
		const candidates = Array.from({ length: 13 }, (_, index) => candidate(String(index), START.lon, index / 13));
		const snapshot = structuredClone(candidates);
		const result = plan(candidates, 20);
		expect(result.stops.map((stop) => stop.candidate.place.id).sort()).toEqual(['10', '11']);
		expect(candidates).toEqual(snapshot);
		expect(plan([candidate('same'), candidate('same')]).stops).toHaveLength(1);
	});
	it.each([30, 60, 90])('includes all walking and visits within a %i minute budget', (budget) => {
		const result = plan([candidate('a', 71.431), candidate('b', 71.434), candidate('c', 71.438)], budget);
		expect(result.stops.length).toBeGreaterThan(0);
		expect(result.totalMinutes).toBeLessThanOrEqual(budget);
		expect(result.totalMinutes).toBe(
			result.legs.reduce((sum, leg) => sum + leg.walkMinutes, 0) +
				result.stops.reduce((sum, stop) => sum + stop.candidate.visitMinutes, 0),
		);
	});
	it('honours a single-stop cap and rejects invalid starts, coordinates and numeric inputs', () => {
		expect(plan([candidate('a'), candidate('b')], 60, 1).stops).toHaveLength(1);
		for (const value of [NaN, Infinity, -1]) {
			expect(plan([candidate('a')], value).stops).toEqual([]);
			expect(plan([candidate('a')], 60, value).stops).toEqual([]);
		}
		for (const lon of [NaN, Infinity, 181]) expect(plan([candidate('bad', lon)]).stops).toEqual([]);
		expect(
			planWalk({ candidates: [candidate('a')], durationMinutes: 60, maxStops: 3, start: { lat: 91, lon: 71.43 } })
				.stops,
		).toEqual([]);
		expect(plan([candidate('far', 72)]).stops).toEqual([]);
	});
	it('rejects negative visits and invalid scores rather than creating time', () => {
		expect(plan([candidate('bad', START.lon, 1, -20), candidate('ok')], 5).stops).toEqual([]);
		expect(plan([candidate('bad', START.lon, Infinity)]).stops).toEqual([]);
	});
	it('chooses the same tied route regardless of input order and warns about unknown hours', () => {
		const a = candidate('a');
		const b = candidate('b');
		b.open = openStatus(null, new Date('2026-10-19T07:00:00Z'));
		expect(plan([a, b])).toEqual(plan([b, a]));
		expect(plan([b]).note).toContain('часы работы неизвестны');
	});

	it('matches an independent exhaustive oracle for singles, pairs and triples', () => {
		const candidates = [
			candidate('a', 71.431, 0.3),
			candidate('b', 71.445, 0.9),
			candidate('c', 71.432, 0.5),
			candidate('d', 71.425, 0.7),
		];
		for (const budget of [20, 30, 40, 50]) {
			let optimum = -1;
			for (const first of candidates)
				for (const second of [null, ...candidates])
					for (const third of [null, ...candidates]) {
						const sequence = second ? (third ? [first, second, third] : [first, second]) : [first];
						if (new Set(sequence.map((entry) => entry.place.id)).size === sequence.length) {
							let elapsed = 0;
							let previous = START;
							for (const stop of sequence) {
								elapsed += walkMinutes(distanceM(previous, stop.place)) + stop.visitMinutes;
								previous = stop.place;
							}
							if (elapsed <= budget)
								optimum = Math.max(
									optimum,
									sequence.reduce((sum, stop) => sum + stop.score, 0),
								);
						}
					}
			const result = plan(candidates, budget);
			expect(result.totalMinutes).toBeLessThanOrEqual(budget);
			expect(result.stops.length ? result.stops.reduce((sum, stop) => sum + stop.candidate.score, 0) : -1).toBe(
				optimum,
			);
		}
	});
});
