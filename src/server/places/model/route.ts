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
// When the user asked for a number of stops that full visits cannot fit, a stop may become a short
// one: half its estimate, never under ten minutes. A show, a film or a zoo cannot be halved.
const SHORT_VISIT_SHARE = 0.5;
const SHORT_VISIT_FLOOR = 10;
// The walking calculator snaps each end up to 75 m onto a path and walks 75 m a minute.
const GRAPH_SNAP_M = 75;
const GRAPH_SPEED_M_PER_MIN = 75;
const FIXED_VISIT = new Set<Category>(['cinema', 'nightclub', 'theatre', 'theme_park', 'zoo']);

/** The longest single leg a walk of this length may contain. The reply quotes the same number. */
export function legCapMinutes(durationMinutes: number): number {
	return Math.max(LEG_CAP_MINUTES, LEG_CAP_SHARE * durationMinutes);
}

/** The shortest honest visit for a stop on a compact route; equal to the estimate when fixed. */
export function shortVisitMinutes(candidate: Candidate): number {
	if (FIXED_VISIT.has(candidate.place.category)) return candidate.visitMinutes;
	return Math.min(
		candidate.visitMinutes,
		Math.max(SHORT_VISIT_FLOOR, Math.round(candidate.visitMinutes * SHORT_VISIT_SHARE)),
	);
}

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

type Measure = (from: GeoPoint, to: GeoPoint) => { distanceM: number; walkMinutes: number } | null;

/** Exhaustive search over at most 12 candidates and 3 stops: small enough to be exact. */
function bestStops(
	pool: readonly Candidate[],
	{
		durationMinutes,
		legCap,
		maxStops,
		measure,
		start,
		targetStops,
	}: {
		durationMinutes: number;
		legCap: number;
		maxStops: number;
		measure: Measure;
		start: GeoPoint;
		targetStops: number;
	},
): Candidate[] {
	let best: Candidate[] = [];
	let bestMeets = false;
	let bestAnchored = false;
	let bestScore = -Infinity;
	let bestMinutes = Infinity;
	// Anchor selection must obey the same graph and per-leg limit as the final route.
	let anchor: Candidate | null = null;
	for (const candidate of pool) {
		const leg = measure(start, candidate.place);
		if (
			leg !== null &&
			leg.walkMinutes <= legCap &&
			leg.walkMinutes + candidate.visitMinutes <= durationMinutes &&
			(anchor === null || candidate.score > anchor.score)
		)
			anchor = candidate;
	}

	function search(state: { current: GeoPoint; minutes: number; score: number; stops: Candidate[] }): void {
		const { current, minutes, score, stops } = state;
		// The number of stops the user asked for comes first, then the best reachable place, then score.
		const meets = stops.length >= targetStops;
		const anchored = anchor !== null && stops.includes(anchor);
		const better =
			Number(meets) - Number(bestMeets) ||
			Number(anchored) - Number(bestAnchored) ||
			(score > bestScore + SCORE_EPSILON
				? 1
				: Math.abs(score - bestScore) <= SCORE_EPSILON && minutes < bestMinutes
					? 1
					: -1);
		if (stops.length >= 1 && better > 0) {
			best = [...stops];
			bestMeets = meets;
			bestAnchored = anchored;
			bestScore = score;
			bestMinutes = minutes;
		}
		if (stops.length >= maxStops) return;
		for (const candidate of pool) {
			const leg = measure(current, candidate.place);
			if (leg !== null && leg.walkMinutes <= legCap && compatible(stops, candidate)) {
				const nextMinutes = minutes + leg.walkMinutes + candidate.visitMinutes;
				if (nextMinutes <= durationMinutes) {
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
	search({ current: start, minutes: 0, score: 0, stops: [] });
	return best;
}

export function planWalk(input: {
	candidates: readonly Candidate[];
	durationMinutes: number;
	maxStops: number;
	measureLeg?: Measure;
	/** Stops the user explicitly asked for («из трёх мест»); visits may be shortened to reach it. */
	requestedStops?: number;
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
	const targetStops =
		input.requestedStops !== undefined && Number.isFinite(input.requestedStops)
			? Math.max(1, Math.min(maxStops, Math.floor(input.requestedStops)))
			: 1;
	const legCap = legCapMinutes(input.durationMinutes);
	const measured = new Map<string, { distanceM: number; walkMinutes: number } | null>();
	const measure: Measure = (from, to) => {
		const key = JSON.stringify([from.lat, from.lon, to.lat, to.lon]);
		if (!measured.has(key)) {
			const meters = distanceM(from, to);
			// A graph path is never shorter than the straight line minus both snaps, so a leg that
			// cannot fit the cap even then is skipped without a path search (the slow part).
			const hopeless = (meters - 2 * GRAPH_SNAP_M) / GRAPH_SPEED_M_PER_MIN > legCap;
			const leg = input.measureLeg
				? hopeless
					? null
					: input.measureLeg(from, to)
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
	const options = {
		durationMinutes: input.durationMinutes,
		legCap,
		maxStops,
		measure,
		start: input.start,
		targetStops,
	};
	let best = bestStops(pool, options);
	let shortened = false;
	// Full visits first; only a stated number of stops that does not fit earns short visits.
	if (best.length < targetStops) {
		const compact = bestStops(
			pool.map((candidate) => ({ ...candidate, visitMinutes: shortVisitMinutes(candidate) })),
			options,
		);
		if (compact.length >= targetStops) {
			// Give the minutes the compact route left over back to the stops, in order, up to full visits.
			const full = new Map(pool.map((candidate) => [candidate.place.id, candidate.visitMinutes]));
			let walked = 0;
			let previous = input.start;
			for (const candidate of compact) {
				walked += measure(previous, candidate.place)!.walkMinutes;
				previous = candidate.place;
			}
			let slack = input.durationMinutes - walked - compact.reduce((sum, stop) => sum + stop.visitMinutes, 0);
			best = compact.map((candidate) => {
				// Whole five-minute steps: an estimate of «21 мин» claims a precision nobody has.
				const extra = Math.max(
					0,
					Math.min(full.get(candidate.place.id)! - candidate.visitMinutes, Math.floor(slack / 5) * 5),
				);
				slack -= extra;
				return extra > 0 ? { ...candidate, visitMinutes: candidate.visitMinutes + extra } : candidate;
			});
			shortened = best.some((candidate) => candidate.visitMinutes < full.get(candidate.place.id)!);
		}
	}
	let elapsed = 0;
	let previous = input.start;
	const legs: WalkPlan['legs'] = [];
	const stops = best.map((candidate, index) => {
		const leg = measure(previous, candidate.place)!;
		// A supplied graph measurement already includes detours; never inflate it again.
		const to = { lat: candidate.place.lat, lon: candidate.place.lon };
		legs.push({ distanceM: leg.distanceM, from: previous, to, walkMinutes: leg.walkMinutes });
		elapsed += leg.walkMinutes;
		const stop = { arriveAtMinute: elapsed, candidate, order: index + 1 };
		elapsed += candidate.visitMinutes;
		previous = to;
		return stop;
	});
	return {
		legs,
		note: best.length
			? [
					// The pedestrian-network caveat belongs to walkingRoute; only the fallback method is named here.
					input.measureLeg ? null : 'Время ходьбы: расстояния по прямой ×1,3 при скорости 75 м/мин.',
					shortened ? 'Чтобы уместить все остановки, время на части посещений сокращено (оценка).' : null,
					best.some((candidate) => candidate.open.status === 'unknown')
						? 'У части мест часы работы неизвестны — уточните перед выходом.'
						: null,
				]
					.filter(Boolean)
					.join(' ')
			: empty.note,
		stops,
		totalMinutes: elapsed,
	};
}
