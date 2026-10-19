import { type ChatMessage, type ChatRequest, type ToolCall } from '@server/agent/model/agent.schema';
import {
	type Candidate,
	type FindPlacesResult,
	findPlacesResultSchema,
	type GeoPoint,
	type WalkPlan,
	walkPlanSchema,
} from '@server/places/model/places.schema';

/** Only the validated result of a successful places tool may reach a marker or card. */
export function readPlacesResults(calls: readonly ToolCall[]) {
	let search: FindPlacesResult | null = null;
	let plan: WalkPlan | null = null;
	for (const call of calls.filter((item) => item.status === 'ok')) {
		if (call.name === 'find_places') {
			const parsed = findPlacesResultSchema.safeParse(call.result);
			if (parsed.success) search = parsed.data;
		}
		if (call.name === 'plan_walk') {
			const parsed = walkPlanSchema.safeParse(call.result);
			if (parsed.success) plan = parsed.data;
		}
	}
	const candidates: Candidate[] = [];
	const seen = new Set<string>();
	for (const candidate of [...(plan?.stops.map((stop) => stop.candidate) ?? []), ...(search?.candidates ?? [])]) {
		if (!seen.has(candidate.place.id)) {
			seen.add(candidate.place.id);
			candidates.push(candidate);
		}
	}
	return { candidates, plan, search };
}

export function buildChatRequest(messages: readonly ChatMessage[], location?: GeoPoint): ChatRequest {
	return {
		...(location === undefined
			? {}
			: { location: { lat: Math.round(location.lat * 1000) / 1000, lon: Math.round(location.lon * 1000) / 1000 } }),
		messages: [...messages],
	};
}
