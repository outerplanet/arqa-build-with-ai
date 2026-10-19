import 'server-only';
import { distanceM, walkMinutes } from './geo';
import { type Candidate, type GeoPoint, geoPointSchema, type WalkPlan } from './places.schema';

// Reordering the same scores can change their sum by a floating-point rounding error.
const SCORE_EPSILON = 1e-12;

export function planWalk(input: {
	candidates: readonly Candidate[];
	durationMinutes: number;
	maxStops: number;
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
		.sort((a, b) => (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0));
	const maxStops = Math.min(3, Math.floor(input.maxStops));
	let best: Candidate[] = [];
	let bestScore = -Infinity;
	let bestMinutes = Infinity;

	function search(state: { current: GeoPoint; minutes: number; score: number; stops: Candidate[] }): void {
		const { current, minutes, score, stops } = state;
		if (
			stops.length >= 1 &&
			(score > bestScore + SCORE_EPSILON || (Math.abs(score - bestScore) <= SCORE_EPSILON && minutes < bestMinutes))
		) {
			best = [...stops];
			bestScore = score;
			bestMinutes = minutes;
		}
		if (stops.length >= maxStops) return;
		for (const candidate of pool) {
			const nextMinutes = minutes + walkMinutes(distanceM(current, candidate.place)) + candidate.visitMinutes;
			if (!stops.some((stop) => stop.place.id === candidate.place.id) && nextMinutes <= input.durationMinutes) {
				search({
					current: candidate.place,
					minutes: nextMinutes,
					score: score + candidate.score,
					stops: [...stops, candidate],
				});
			}
		}
	}
	search({ current: input.start, minutes: 0, score: 0, stops: [] });
	let elapsed = 0;
	let previous = input.start;
	const legs: WalkPlan['legs'] = [];
	const stops = best.map((candidate, index) => {
		const meters = distanceM(previous, candidate.place);
		const minutes = walkMinutes(meters);
		// Keep straight-line meters; walkMinutes applies the 1.3 detour factor exactly once.
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
