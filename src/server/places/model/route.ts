import 'server-only';
import { distanceM, walkMinutes } from './geo';
import { type Candidate, type GeoPoint, type WalkPlan } from './places.schema';

export function planWalk(input: {
	candidates: readonly Candidate[];
	durationMinutes: number;
	maxStops: number;
	start: GeoPoint;
}): WalkPlan {
	const pool = input.candidates.slice(0, 12).filter((candidate) => candidate.open.status !== 'closed');
	const maxStops = Math.min(3, Math.max(2, Math.floor(input.maxStops)));
	let best: Candidate[] = [];
	let bestScore = -Infinity;
	let bestMinutes = Infinity;

	function search(state: { current: GeoPoint; minutes: number; score: number; stops: Candidate[] }): void {
		const { current, minutes, score, stops } = state;
		if (stops.length >= 2 && (score > bestScore || (score === bestScore && minutes < bestMinutes))) {
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
			? 'Время ходьбы: расстояния по прямой ×1,3 при скорости 75 м/мин; посещения включены.'
			: 'За указанное время маршрут из двух доступных мест не найден; часы работы неизвестных мест уточните.',
		stops,
		totalMinutes: elapsed,
	};
}
