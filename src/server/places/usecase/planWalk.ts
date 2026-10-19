import { DomainError } from '@server/kernel/errors';
import { planWalkInputSchema, type WalkPlan, walkPlanSchema } from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { findPlaces } from './findPlaces';
import { assertOrigin, origin } from './origin';

export async function planWalk(ctx: PlacesContext, input: z.input<typeof planWalkInputSchema>): Promise<WalkPlan> {
	const parsed = planWalkInputSchema.parse(input);

	assertOrigin(ctx, parsed.start);
	const found = await findPlaces(ctx, {
		categories: parsed.categories,
		limit: 10,
		maxWalkMinutes: Math.min(90, Math.max(5, parsed.durationMinutes)),
		query: parsed.query ?? 'прогулка',
	});
	const result = walkPlanSchema.parse(
		dependencies(ctx).planWalk({
			candidates: found.candidates,
			durationMinutes: parsed.durationMinutes,
			maxStops: parsed.maxStops,
			start: origin(ctx).point,
		}),
	);

	if (result.totalMinutes > parsed.durationMinutes || result.stops.length > parsed.maxStops) {
		throw new DomainError('validation', { constraint: 'invalid_walk_plan' });
	}

	return result;
}
