import { DomainError } from '@server/kernel/errors';
import {
	type Candidate,
	type Category,
	type GeoPoint,
	planWalkInputSchema,
	type WalkPlan,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import { shortVisitMinutes } from '@server/places/model/route';
import { type WalkingRoute } from '@server/places/model/walkingRoute.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { searchPlaces } from './findPlaces';
import { assertOrigin, origin, roundLocation } from './origin';
import { walkingCalculator } from './walking';

const ROUTE_SIGHTS = new Set<Category>([
	'artwork',
	'attraction',
	'gallery',
	'monument',
	'museum',
	'theatre',
	'viewpoint',
]);

/** A stop matches the search result exactly, except that its visit may be shortened, never below the short estimate. */
function sameCandidate(stop: Candidate, known: Candidate | undefined): boolean {
	if (known === undefined) return false;
	if (stop.visitMinutes > known.visitMinutes || stop.visitMinutes < shortVisitMinutes(known)) return false;
	return JSON.stringify({ ...stop, visitMinutes: known.visitMinutes }) === JSON.stringify(known);
}

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
	const known = new Map(input.candidates.map((candidate) => [candidate.place.id, candidate]));
	const seen = new Set<string>();
	let previous = input.start;
	let elapsed = 0;

	for (const [index, stop] of plan.stops.entries()) {
		const leg = plan.legs[index]!;
		if (
			!sameCandidate(stop.candidate, known.get(stop.candidate.place.id)) ||
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

export async function planWalk(
	ctx: PlacesContext,
	input: z.input<typeof planWalkInputSchema> & {
		/** Stops the user explicitly asked for; parsed by the server from their words, not by the model. */
		requestedStops?: number;
	},
): Promise<WalkPlan & { walkingRoute: WalkingRoute }> {
	const parsed = planWalkInputSchema.parse(input);

	assertOrigin(ctx, parsed.start);
	const requestedStops =
		input.requestedStops === undefined ? undefined : Math.min(parsed.maxStops, Math.floor(input.requestedStops));
	const found = await searchPlaces(ctx, {
		durationMinutes: parsed.durationMinutes,
		filters: {
			categories: parsed.categories,
			limit: 10,
			// Three stops in one budget are close to each other: a pool reaching the whole budget away
			// fills its ten slots with places no compact route can use.
			maxWalkMinutes: Math.min(
				90,
				Math.max(5, (requestedStops ?? 1) >= 3 ? Math.round(parsed.durationMinutes / 3) : parsed.durationMinutes),
			),
			query: parsed.query ?? 'прогулка',
		},
		// A route of sights should pass places the data vouches for, not «Сквер» and a shop gallery.
		preferNotable: parsed.categories?.some((category) => ROUTE_SIGHTS.has(category)) ?? true,
	});
	const walking = walkingCalculator(ctx);
	const result = walkPlanSchema.parse(
		dependencies(ctx).planWalk({
			candidates: found.candidates,
			durationMinutes: parsed.durationMinutes,
			maxStops: parsed.maxStops,
			...(requestedStops === undefined ? {} : { requestedStops }),
			start: origin(ctx).point,
			...(walking ? { measureLeg: walking.measureLeg } : {}),
		}),
	);

	validatePlan(result, {
		candidates: found.candidates,
		durationMinutes: parsed.durationMinutes,
		maxStops: parsed.maxStops,
		start: origin(ctx).point,
	});

	const walkingRoute = walking?.routeFor(result) ?? {
		note: 'Пешеходная сеть недоступна: время по прямой, путь на карте не показан.',
		status: 'unavailable' as const,
	};
	return {
		...result,
		// The pedestrian-network caveat lives once, in walkingRoute.note; the reply quotes it.
		note: [result.note, found.note].filter(Boolean).join(' '),
		walkingRoute,
	};
}
