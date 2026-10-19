import 'server-only';
import { distanceM, walkMinutes } from './geo';
import { type Candidate, type Category, type GeoPoint, geoPointSchema, type WalkPlan } from './places.schema';

// Reordering the same scores can change their sum by a floating-point rounding error.
const SCORE_EPSILON = 1e-12;
// No single leg may take longer than this many minutes or this share of the whole budget,
// whichever is larger: a 90-minute walk must not spend 43 minutes reaching its first stop.
const LEG_CAP_MINUTES = 15;
const LEG_CAP_SHARE = 0.25;
// Two stops of the same category closer than this are one stop (three rocket models 25 m apart).
const CLUSTER_M = 100;
// A walk has at most one food stop; the rest should be things to see.
const FOOD = new Set<Category>(['bar', 'cafe', 'fast_food', 'restaurant']);

function byId(a: Candidate, b: Candidate): number {
	return a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0;
}

function compatible(stops: readonly Candidate[], next: Candidate): boolean {
	return stops.every(
		(stop) =>
			stop.place.id !== next.place.id &&
			!(FOOD.has(stop.place.category) && FOOD.has(next.place.category)) &&
			(stop.place.category !== next.place.category || distanceM(stop.place, next.place) >= CLUSTER_M),
	);
}

export function planWalk(input: {
	candidates: readonly Candidate[];
	durationMinutes: number;
	maxStops: number;
	measureLeg?: (from: GeoPoint, to: GeoPoint) => { distanceM: number; walkMinutes: number } | null;
	start: GeoPoint;
}): WalkPlan {
	const empty: WalkPlan = {
		legs: [],
		note: 'За указанное время подходящих мест для прогулки не найдено.',
		stops: [],
		totalMinutes: 0,
	};
	if (
		!geoPointSchema.safeParse(input.start).success ||
		!Number.isFinite(input.durationMinutes) ||
		input.durationMinutes < 0 ||
		!Number.isFinite(input.maxStops) ||
		input.maxStops < 1
	)
		return empty;
	const pool = input.candidates
		.slice(0, 12)
		.filter(
			(candidate) =>
				candidate.open.status !== 'closed' &&
				geoPointSchema.safeParse(candidate.place).success &&
				Number.isFinite(candidate.score) &&
				candidate.score >= 0 &&
				candidate.score <= 1 &&
				Number.isFinite(candidate.visitMinutes) &&
				candidate.visitMinutes >= 0,
		)
		.sort(byId);
	const maxStops = Math.min(3, Math.floor(input.maxStops));
	const legCap = Math.max(LEG_CAP_MINUTES, LEG_CAP_SHARE * input.durationMinutes);
	let best: Candidate[] = [];
	let bestAnchored = false;
	let bestScore = -Infinity;
	let bestMinutes = Infinity;
	const measured = new Map<string, { distanceM: number; walkMinutes: number } | null>();
	const measure = (from: GeoPoint, to: GeoPoint) => {
		const key = JSON.stringify([from.lat, from.lon, to.lat, to.lon]);
		if (!measured.has(key)) {
			const meters = distanceM(from, to);
			const leg = input.measureLeg
				? input.measureLeg(from, to)
				: { distanceM: meters, walkMinutes: walkMinutes(meters) };
			measured.set(
				key,
				leg &&
					Number.isFinite(leg.distanceM) &&
					leg.distanceM >= 0 &&
					Number.isFinite(leg.walkMinutes) &&
					leg.walkMinutes >= 0
					? leg
					: null,
			);
		}
		return measured.get(key) ?? null;
	};
	// Anchor selection must obey the same graph and per-leg limit as the final route.
	let anchor: Candidate | null = null;
	for (const candidate of pool) {
		const leg = measure(input.start, candidate.place);
		if (
			leg !== null &&
			leg.walkMinutes <= legCap &&
			leg.walkMinutes + candidate.visitMinutes <= input.durationMinutes &&
			(anchor === null || candidate.score > anchor.score)
		)
			anchor = candidate;
	}

	function search(state: { current: GeoPoint; minutes: number; score: number; stops: Candidate[] }): void {
		const { current, minutes, score, stops } = state;
		const anchored = anchor !== null && stops.includes(anchor);
		if (
			stops.length >= 1 &&
			(Number(anchored) > Number(bestAnchored) ||
				(anchored === bestAnchored &&
					(score > bestScore + SCORE_EPSILON ||
						(Math.abs(score - bestScore) <= SCORE_EPSILON && minutes < bestMinutes))))
		) {
			best = [...stops];
			bestAnchored = anchored;
			bestScore = score;
			bestMinutes = minutes;
		}
		if (stops.length >= maxStops) return;
		for (const candidate of pool) {
			const leg = measure(current, candidate.place);
			if (leg !== null && leg.walkMinutes <= legCap && compatible(stops, candidate)) {
				const nextMinutes = minutes + leg.walkMinutes + candidate.visitMinutes;
				if (nextMinutes <= input.durationMinutes) {
					search({
						current: candidate.place,
						minutes: nextMinutes,
						score: score + candidate.score,
						stops: [...stops, candidate],
					});
				}
			}
		}
	}
	search({ current: input.start, minutes: 0, score: 0, stops: [] });
	let elapsed = 0;
	let previous = input.start;
	const legs: WalkPlan['legs'] = [];
	const stops = best.map((candidate, index) => {
		const leg = measure(previous, candidate.place)!;
		const meters = leg.distanceM;
		const minutes = leg.walkMinutes;
		// A supplied graph measurement already includes detours; never inflate it again.
		const to = { lat: candidate.place.lat, lon: candidate.place.lon };
		legs.push({ distanceM: meters, from: previous, to, walkMinutes: minutes });
		elapsed += minutes;
		const stop = { arriveAtMinute: elapsed, candidate, order: index + 1 };
		elapsed += candidate.visitMinutes;
		previous = to;
		return stop;
	});
	return {
		legs,
		note: best.length
			? `Время ходьбы: расстояния по прямой ×1,3 при скорости 75 м/мин; посещения включены.${best.some((candidate) => candidate.open.status === 'unknown') ? ' У части мест часы работы неизвестны — уточните перед выходом.' : ''}`
			: empty.note,
		stops,
		totalMinutes: elapsed,
	};
}
