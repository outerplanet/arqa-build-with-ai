import { type ChatMessage, type ChatRequest, chatRequestSchema } from '@server/agent/model/agent.schema';
import { type GeoPoint, geoPointSchema } from '@server/places/model/places.schema';

export function normalizeLocation(point: GeoPoint | null): GeoPoint | null {
	const parsed = geoPointSchema.safeParse(point);
	return parsed.success
		? { lat: Math.round(parsed.data.lat * 1000) / 1000, lon: Math.round(parsed.data.lon * 1000) / 1000 }
		: null;
}

/** Zod creates a detached snapshot, so changing location cannot rewrite a failed request. */
export function createChatRequest(messages: readonly ChatMessage[], location: GeoPoint | null): ChatRequest {
	const point = normalizeLocation(location);
	return chatRequestSchema.parse({ messages, ...(point === null ? {} : { location: point }) });
}
