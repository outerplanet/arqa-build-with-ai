import 'server-only';
import { describe, expect, it } from 'vitest';
import { distanceM, walkMinutes } from './geo';
import { openStatus } from './hours';
import { type Candidate, type Category, type GeoPoint, walkPlanSchema } from './places.schema';
import { legCapMinutes, planWalk, shortVisitMinutes } from './route';

const START = { lat: 51.128, lon: 71.43 };
// Distinct non-food categories by default so the same-category and food rules stay out of the way.
const SIGHTS: Category[] = [
	'museum',
	'gallery',
	'theatre',
	'cinema',
	'park',
	'garden',
	'playground',
	'viewpoint',
	'attraction',
	'monument',
	'artwork',
	'mall',
	'library',
	'zoo',
	'theme_park',
	'sports',
	'place_of_worship',
	'other',
	'nightclub',
];
const FOOD: Category[] = ['cafe', 'restaurant', 'fast_food', 'bar'];
let created = 0;
function candidate(
	id: string,
	...[lon = START.lon, score = 0.5, visitMinutes = 10, category = SIGHTS[created % SIGHTS.length]!]: [
		number?,
		number?,
		number?,
		Category?,
	]
): Candidate {
	created += 1;
	return {
		distanceM: 0,
		open: openStatus('24/7', new Date('2026-10-19T07:00:00Z')),
		place: {
			...START,
			address: null,
			category,
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
	it('uses graph distances and budgets instead of crossing an obstacle directly', () => {
		const result = planWalk({
			candidates: [candidate('osm:node/1')],
			durationMinutes: 22,
			maxStops: 3,
			measureLeg: () => ({ distanceM: 900, walkMinutes: 12 }),
			start: START,
		});
		expect(result.totalMinutes).toBe(22);
		expect(result.legs[0]).toMatchObject({ distanceM: 900, walkMinutes: 12 });
		expect(
			planWalk({
				candidates: [candidate('osm:node/1')],
				durationMinutes: 21,
				maxStops: 3,
				measureLeg: () => ({ distanceM: 900, walkMinutes: 12 }),
				start: START,
			}).stops,
		).toEqual([]);
	});
	it('never replaces an unreachable graph leg with a straight-line shortcut', () => {
		for (const leg of [null, { distanceM: NaN, walkMinutes: 1 }, { distanceM: 10, walkMinutes: -1 }]) {
			expect(
				planWalk({
					candidates: [candidate('osm:node/1')],
					durationMinutes: 60,
					maxStops: 3,
					measureLeg: () => leg,
					start: START,
				}).stops,
			).toEqual([]);
		}
	});
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
			candidate('a', 71.431, 0.3, 10, 'cafe'),
			candidate('b', 71.445, 0.9, 10, 'museum'),
			candidate('c', 71.432, 0.5, 10, 'restaurant'),
			candidate('d', 71.425, 0.7, 10, 'park'),
			candidate('e', 71.4255, 0.4, 10, 'park'),
			candidate('f', 71.428, 0.2, 10, 'monument'),
		];
		for (const budget of [20, 30, 40, 50, 90]) {
			const cap = Math.max(15, budget / 4);
			const reachable = candidates.filter(
				(entry) =>
					walkMinutes(distanceM(START, entry.place)) <= cap &&
					walkMinutes(distanceM(START, entry.place)) + entry.visitMinutes <= budget,
			);
			const anchor = reachable.reduce<Candidate | null>(
				(top, entry) => (top === null || entry.score > top.score ? entry : top),
				null,
			);
			let optimum = { anchored: false, score: -1 };
			for (const first of candidates)
				for (const second of [null, ...candidates])
					for (const third of [null, ...candidates]) {
						const sequence = second ? (third ? [first, second, third] : [first, second]) : [first];
						const pairs = sequence.flatMap((x, i) => sequence.slice(i + 1).map((y) => [x, y] as const));
						if (
							new Set(sequence.map((entry) => entry.place.id)).size === sequence.length &&
							sequence.filter((entry) => FOOD.includes(entry.place.category)).length <= 1 &&
							pairs.every(
								([x, y]) => x.place.category !== y.place.category || distanceM(x.place, y.place) >= 100,
							)
						) {
							let elapsed = 0;
							let longest = 0;
							let previous: GeoPoint = START;
							for (const stop of sequence) {
								const walk = walkMinutes(distanceM(previous, stop.place));
								longest = Math.max(longest, walk);
								elapsed += walk + stop.visitMinutes;
								previous = stop.place;
							}
							const score = sequence.reduce((sum, stop) => sum + stop.score, 0);
							const anchored = anchor !== null && sequence.includes(anchor);
							if (
								elapsed <= budget &&
								longest <= cap &&
								(Number(anchored) > Number(optimum.anchored) ||
									(anchored === optimum.anchored && score > optimum.score + 1e-9))
							)
								optimum = { anchored, score };
						}
					}
			const result = plan(candidates, budget);
			expect(result.totalMinutes).toBeLessThanOrEqual(budget);
			expect(result.stops.some((stop) => stop.candidate === anchor)).toBe(optimum.anchored);
			expect(
				result.stops.length ? result.stops.reduce((sum, stop) => sum + stop.candidate.score, 0) : -1,
			).toBeCloseTo(optimum.score);
		}
	});

	it('treats a same-category cluster as one stop and keeps the top nearby place (EXPO rockets)', () => {
		const expo = { lat: 51.09, lon: 71.416 };
		const located = (entry: Candidate, point: GeoPoint): Candidate => ({
			...entry,
			place: { ...entry.place, ...point },
		});
		const alem = located(candidate('alem', START.lon, 0.6, 60, 'museum'), { lat: 51.089252, lon: 71.4161925 });
		const rockets = [0, 0.00035, 0.0007].map((offset, index) =>
			located(candidate(`rocket-${index}`, START.lon, 0.53, 15, 'artwork'), {
				lat: 51.0784556,
				lon: 71.3861753 + offset,
			}),
		);
		const alley = located(candidate('alley', START.lon, 0.5, 40, 'park'), { lat: 51.0915, lon: 71.4215 });
		const result = planWalk({ candidates: [...rockets, alley, alem], durationMinutes: 90, maxStops: 3, start: expo });
		const ids = result.stops.map((stop) => stop.candidate.place.id);
		expect(ids).toContain('alem');
		expect(ids.filter((id) => id.startsWith('rocket')).length).toBeLessThanOrEqual(1);
		expect(result.legs.every((leg) => leg.walkMinutes <= 22.5)).toBe(true);
		expect(result.totalMinutes).toBeLessThanOrEqual(90);

		const near = [0, 0.00035, 0.0007].map((offset, index) =>
			candidate(`statue-${index}`, START.lon + 0.001 + offset, 0.9, 10, 'artwork'),
		);
		const museum = candidate('museum', START.lon + 0.004, 0.3, 10, 'museum');
		const clustered = plan([...near, museum], 90).stops.map((stop) => stop.candidate.place.id);
		expect(clustered.filter((id) => id.startsWith('statue'))).toHaveLength(1);
		expect(clustered).toContain('museum');
		const apart = [
			candidate('art-1', START.lon + 0.001, 0.9, 10, 'artwork'),
			candidate('art-2', START.lon + 0.004, 0.9, 10, 'artwork'),
		];
		expect(plan(apart, 90).stops).toHaveLength(2);
	});

	it('caps every leg at the larger of 15 minutes and a quarter of the budget', () => {
		const far = candidate('far', START.lon + 0.015, 0.9, 0);
		const walk = walkMinutes(distanceM(START, far.place));
		expect(walk).toBeGreaterThan(15);
		expect(walk).toBeLessThan(30);
		expect(plan([far], 40).stops).toEqual([]);
		expect(plan([far], 120).stops).toHaveLength(1);
		const hop = candidate('hop', START.lon + 0.0075, 0.5, 0);
		const beyond = candidate('beyond', START.lon + 0.03, 0.9, 0);
		expect(plan([hop, beyond], 60).stops.map((stop) => stop.candidate.place.id)).toEqual(['hop']);
	});

	it('allows at most one food stop and prefers sights to a food-only route', () => {
		const food = FOOD.map((category, index) =>
			candidate(`food-${index}`, START.lon + index * 0.003, 0.8, 20, category),
		);
		const park = candidate('park', START.lon + 0.002, 0.3, 20, 'park');
		const monument = candidate('monument', START.lon + 0.005, 0.3, 15, 'monument');
		const result = plan([...food, park, monument], 120);
		const categories = result.stops.map((stop) => stop.candidate.place.category);
		expect(categories.filter((category) => FOOD.includes(category))).toHaveLength(1);
		expect(result.stops).toHaveLength(3);
		expect(plan(food, 120).stops).toHaveLength(1);
	});

	it('includes the best-scored nearby place even when other sets add up to more', () => {
		const top = candidate('top', START.lon + 0.001, 0.7, 60);
		const others = ['x', 'y', 'z'].map((id, index) => candidate(id, START.lon + 0.002 + index * 0.002, 0.6, 20));
		const result = plan([...others, top], 90);
		expect(result.stops.map((stop) => stop.candidate.place.id)).toContain('top');
	});

	describe('a requested number of stops', () => {
		// Three 30-minute stops about 2 minutes apart: full visits fit one stop in 60 minutes, not three.
		const parks = () =>
			[0.001, 0.002, 0.003].map((offset, index) =>
				candidate(
					`park-${index}`,
					START.lon + offset * 1.5,
					0.5,
					30,
					(['park', 'garden', 'attraction'] as const)[index],
				),
			);

		it('keeps full visits and fewer stops when nobody asked for a number', () => {
			const result = plan(parks(), 60);
			expect(result.stops).toHaveLength(1);
			expect(result.stops.every((stop) => stop.candidate.visitMinutes === 30)).toBe(true);
			expect(result.note).not.toContain('сокращено');
		});

		it('shortens visits to fit the requested stops, never below the short estimate, and says so', () => {
			const result = planWalk({
				candidates: parks(),
				durationMinutes: 60,
				maxStops: 3,
				requestedStops: 3,
				start: START,
			});
			expect(result.stops).toHaveLength(3);
			expect(result.totalMinutes).toBeLessThanOrEqual(60);
			for (const stop of result.stops) {
				expect(stop.candidate.visitMinutes).toBeGreaterThanOrEqual(
					shortVisitMinutes({ ...stop.candidate, visitMinutes: 30 }),
				);
				expect(stop.candidate.visitMinutes).toBeLessThanOrEqual(30);
			}
			// Leftover minutes go back to the stops, so the budget is used rather than wasted.
			expect(60 - result.totalMinutes).toBeLessThan(5);
			expect(result.stops.some((stop) => stop.candidate.visitMinutes > 15)).toBe(true);
			expect(result.note).toContain('сокращено');
		});

		it('returns fewer stops when even short visits cannot fit, and never a show cut in half', () => {
			const shows = parks().map((entry) => ({ ...entry, place: { ...entry.place, category: 'theatre' as const } }));
			const result = planWalk({
				candidates: shows,
				durationMinutes: 60,
				maxStops: 3,
				requestedStops: 3,
				start: START,
			});
			expect(result.stops.length).toBeLessThan(3);
			expect(result.stops.every((stop) => stop.candidate.visitMinutes === 30)).toBe(true);
		});

		it('names the per-leg limit the planner enforces', () => {
			expect(legCapMinutes(60)).toBe(15);
			expect(legCapMinutes(90)).toBe(22.5);
		});
	});
});

describe('route variety', () => {
	it('never puts a gallery right after a gallery', () => {
		const pool = [
			candidate('g1', START.lon + 0.004, 0.9, 10, 'gallery'),
			candidate('g2', START.lon + 0.008, 0.9, 10, 'gallery'),
			candidate('m1', START.lon + 0.012, 0.3, 10, 'monument'),
		];
		const walk = planWalk({ candidates: pool, durationMinutes: 90, maxStops: 3, requestedStops: 3, start: START });
		const categories = walk.stops.map((stop) => stop.candidate.place.category);

		expect(categories).toHaveLength(3);
		for (let index = 1; index < categories.length; index += 1)
			expect(categories[index] === 'gallery' && categories[index - 1] === 'gallery').toBe(false);
	});
});
