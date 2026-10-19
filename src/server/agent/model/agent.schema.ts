import { z } from 'zod';

/**
 * The contract between the server and the interface.
 *
 * ESLint classifies a `*.schema.ts` under a domain's `model` directory as `shared-schema` — the
 * one thing inside `src/server` a view is allowed to import. That is why there is no
 * `import 'server-only'` here and nothing but zod: everything in this file may end up in a
 * browser bundle, so nothing in it may reach a key, a connection string or the file system.
 *
 * Put the shapes the UI renders here. Keep the rest in `model/` next door.
 */

/** One executed tool, already shaped for the activity panel. */
export const toolCallSchema = z.object({
	arguments: z.record(z.string(), z.unknown()),
	/** Wall-clock cost of the handler. Shown in the panel: it makes the work look real. */
	durationMs: z.number(),
	/** Human phrase for the panel, carried from the registry so the UI needs no lookup table. */
	label: z.string(),
	name: z.string(),
	result: z.unknown(),
	status: z.enum(['ok', 'error']),
});

export const chatMessageSchema = z.object({
	content: z.string(),
	role: z.enum(['assistant', 'user']),
});

export const chatRequestSchema = z.object({
	/** Browser coordinates are rounded at the validation boundary, before any provider sees them. */
	location: z
		.object({
			lat: z.number().min(-90).max(90),
			lon: z.number().min(-180).max(180),
		})
		.transform(({ lat, lon }) => ({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 }))
		.optional(),
	messages: z.array(chatMessageSchema).min(1),
});

/** One recommended place, in the order of the text reply, with the same server-built wording. */
export const recommendationSchema = z.object({
	/** What to do there, without the «(сгенерированная идея)» marker; always a generated idea. */
	action: z.string(),
	distanceM: z.number().nonnegative(),
	/** One Russian sentence; «открыто» only when the tool's open.status is 'open'. */
	hours: z.string(),
	order: z.number().int().positive(),
	placeId: z.string(),
	visitMinutes: z.number().int().nonnegative(),
	walkMinutes: z.number().nonnegative(),
	/** The «Почему» line, built only from tool-result data. */
	why: z.string(),
});

export const chatResponseSchema = z.object({
	/** Structured form of the same recommendations for the cards; absent when nothing is recommended. */
	recommendations: z.array(recommendationSchema).optional(),
	/** Server selection shared with the text reply; every id still needs a validated tool result. */
	recommendedPlaceIds: z.array(z.string()).optional(),
	reply: z.string(),
	toolCalls: z.array(toolCallSchema),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
