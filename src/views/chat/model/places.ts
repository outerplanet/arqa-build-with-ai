import { type ToolCall } from '@server/agent/model/agent.schema';
import {
	type Candidate,
	findPlacesResultSchema,
	type GeoPoint,
	type WalkPlan,
	walkPlanSchema,
} from '@server/places/model/places.schema';

export interface PlacesView {
	candidates: readonly Candidate[];
	origin: GeoPoint | null;
	plan: WalkPlan | null;
}

/** Markers and route geometry come only from successful, validated server reports. */
export function placesFromToolCalls(calls: readonly ToolCall[]): PlacesView {
	let view: PlacesView = { candidates: [], origin: null, plan: null };
	for (const call of calls) {
		if (call.status !== 'ok') continue;
		if (call.name === 'find_places') {
			const parsed = findPlacesResultSchema.safeParse(call.result);
			if (parsed.success) {
				view = { candidates: parsed.data.candidates, origin: parsed.data.origin.point, plan: null };
			}
		} else if (call.name === 'plan_walk') {
			const parsed = walkPlanSchema.safeParse(call.result);
			if (parsed.success) {
				view = {
					candidates: parsed.data.stops.map((stop) => stop.candidate),
					origin: parsed.data.legs[0]?.from ?? null,
					plan: parsed.data,
				};
			}
		}
	}
	return view;
}
