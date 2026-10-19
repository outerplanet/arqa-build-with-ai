import { type ChatMessage, type ChatRequest, type ToolCall } from '@server/agent/model/agent.schema';
import {
	type Candidate,
	type FindPlacesResult,
	findPlacesResultSchema,
	type GeoPoint,
	type ResolvedLocation,
	resolvedLocationSchema,
	type WalkPlan,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import { type WalkingRoute, walkingRouteSchema } from '@server/places/model/walkingRoute.schema';

/** Only the validated result of a successful places tool may reach a marker or card. */
export function readPlacesResults(
	calls: readonly ToolCall[],
	recommendedPlaceIds: readonly string[] = [],
): {
	candidates: Candidate[];
	plan: WalkPlan | null;
	search: FindPlacesResult | null;
	walkingRoute: WalkingRoute | null;
} {
	let search: FindPlacesResult | null = null;
	let plan: WalkPlan | null = null;
	let walkingRoute: WalkingRoute | null = null;
	for (const call of calls.filter((item) => item.status === 'ok')) {
		if (call.name === 'find_places') {
			const parsed = findPlacesResultSchema.safeParse(call.result);
			if (parsed.success) {
				search = parsed.data;
				plan = null;
				walkingRoute = null;
			}
		}
		if (call.name === 'plan_walk') {
			const parsed = walkPlanSchema.safeParse(call.result);
			if (parsed.success) {
				plan = parsed.data;
				walkingRoute = null;
				const { result } = call;
				const routing = walkingRouteSchema.safeParse(
					typeof result === 'object' && result !== null && 'walkingRoute' in result ? result.walkingRoute : null,
				);
				if (routing.success) {
					const route = routing.data;
					if (
						route.status === 'unavailable' ||
						(route.legs.length === plan.legs.length &&
							route.legs.length === plan.stops.length &&
							route.stopIds.length === plan.stops.length &&
							new Set(route.stopIds).size === route.stopIds.length &&
							plan.stops.every(
								(stop, index) => stop.order === index + 1 && route.stopIds[index] === stop.candidate.place.id,
							))
					)
						walkingRoute = route;
				}
			}
		}
	}
	const candidates: Candidate[] = [];
	if (
		plan !== null &&
		(plan.stops.length === 0 || !plan.stops.every((stop) => recommendedPlaceIds.includes(stop.candidate.place.id)))
	) {
		plan = null;
		walkingRoute = null;
	}
	const seen = new Set<string>();
	for (const candidate of plan?.stops.map((stop) => stop.candidate) ??
		search?.candidates.filter((item) => recommendedPlaceIds.includes(item.place.id)) ??
		[]) {
		if (!seen.has(candidate.place.id)) {
			seen.add(candidate.place.id);
			candidates.push(candidate);
		}
	}
	return { candidates, plan, search, walkingRoute };
}

/** The last validated resolve_location result of the turn, or null. */
export function readResolvedLocation(calls: readonly ToolCall[]): ResolvedLocation | null {
	const found = calls
		.filter((call) => call.status === 'ok' && call.name === 'resolve_location')
		.map((call) => resolvedLocationSchema.safeParse(call.result))
		.findLast((parsed) => parsed.success);
	return found?.data ?? null;
}

export function buildChatRequest(messages: readonly ChatMessage[], location?: GeoPoint): ChatRequest {
	return {
		...(location === undefined
			? {}
			: { location: { lat: Math.round(location.lat * 1000) / 1000, lon: Math.round(location.lon * 1000) / 1000 } }),
		messages: messages.map((message) =>
			location === undefined && message.role === 'assistant'
				? {
						...message,
						// Removing consent must also stop resending the origin echoed in an earlier reply.
						content: message.content.replace(
							/^Локация: -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)? \(геолокация браузера\)\./u,
							'Локация: геолокация браузера больше не передаётся.',
						),
					}
				: message,
		),
	};
}
