import { DomainError } from '@server/kernel/errors';
import {
	type Candidate,
	type GeoPoint,
	planWalkInputSchema,
	type WalkPlan,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { searchPlaces } from './findPlaces';
import { assertOrigin, origin, roundLocation } from './origin';

function validatePlan(
	plan: WalkPlan,
	input: { candidates: readonly Candidate[]; durationMinutes: number; maxStops: number; start: GeoPoint },
): void {
	const invalid = () => {
		throw new DomainError('validation', { constraint: 'invalid_walk_plan' });
	};
	if (
		plan.totalMinutes > input.durationMinutes ||
		plan.stops.length > input.maxStops ||
		plan.legs.length !== plan.stops.length
	)
		invalid();
	const known = new Map(input.candidates.map((candidate) => [candidate.place.id, JSON.stringify(candidate)]));
	const seen = new Set<string>();
	let previous = input.start;
	let elapsed = 0;

	for (const [index, stop] of plan.stops.entries()) {
		const leg = plan.legs[index]!;
		if (
			known.get(stop.candidate.place.id) !== JSON.stringify(stop.candidate) ||
			seen.has(stop.candidate.place.id) ||
			stop.order !== index + 1 ||
			JSON.stringify(roundLocation(leg.from)) !== JSON.stringify(roundLocation(previous)) ||
			JSON.stringify(roundLocation(leg.to)) !== JSON.stringify(roundLocation(stop.candidate.place))
		)
			invalid();
		elapsed += leg.walkMinutes;
		if (Math.abs(stop.arriveAtMinute - elapsed) > 0.01) invalid();
		elapsed += stop.candidate.visitMinutes;
		previous = stop.candidate.place;
		seen.add(stop.candidate.place.id);
	}
	if (Math.abs(plan.totalMinutes - elapsed) > 0.01 || elapsed > input.durationMinutes) invalid();
}

export async function planWalk(ctx: PlacesContext, input: z.input<typeof planWalkInputSchema>): Promise<WalkPlan> {
	const parsed = planWalkInputSchema.parse(input);

	assertOrigin(ctx, parsed.start);
	const found = await searchPlaces(ctx, {
		durationMinutes: parsed.durationMinutes,
		filters: {
			categories: parsed.categories,
			limit: 10,
			maxWalkMinutes: Math.min(90, Math.max(5, parsed.durationMinutes)),
			query: parsed.query ?? 'прогулка',
		},
	});
	const result = walkPlanSchema.parse(
		dependencies(ctx).planWalk({
			candidates: found.candidates,
			durationMinutes: parsed.durationMinutes,
			maxStops: parsed.maxStops,
			start: origin(ctx).point,
		}),
	);

	validatePlan(result, {
		candidates: found.candidates,
		durationMinutes: parsed.durationMinutes,
		maxStops: parsed.maxStops,
		start: origin(ctx).point,
	});

	return { ...result, note: [result.note, found.note].filter(Boolean).join(' ') };
}
