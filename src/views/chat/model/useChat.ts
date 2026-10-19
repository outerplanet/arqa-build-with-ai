'use client';

import {
	type ChatMessage,
	type ChatRequest,
	chatResponseSchema,
	type ToolCall,
} from '@server/agent/model/agent.schema';
import { type GeoPoint } from '@server/places/model/places.schema';
import { useCallback, useRef, useState } from 'react';
import { createChatRequest, normalizeLocation } from './request';

/**
 * The transcript, and the one call that advances it: POST /api/chat with the whole history.
 *
 * There is no session on the server, so the conversation lives here. That is a deliberate trade
 * for a short-lived product: no auth, no store, no migration — and a reload starts clean, which
 * is what you want between two runs of a demo.
 *
 * The response is parsed rather than trusted. A tool call rendered from an unvalidated shape is
 * how the activity panel ends up printing `undefined` in front of an audience.
 */
export type ChatStatus = 'error' | 'idle' | 'sending';

export interface UseChat {
	error: string | null;
	location: GeoPoint | null;
	messages: readonly ChatMessage[];
	retry: () => void;
	send: (content: string) => void;
	setLocation: (point: GeoPoint | null) => void;
	status: ChatStatus;
	toolCalls: readonly ToolCall[];
}

export function useChat(): UseChat {
	const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
	const [toolCalls, setToolCalls] = useState<readonly ToolCall[]>([]);
	const [status, setStatus] = useState<ChatStatus>('idle');
	const [error, setError] = useState<string | null>(null);
	const [location, updateLocation] = useState<GeoPoint | null>(null);
	const locationRef = useRef<GeoPoint | null>(null);
	const lastRequest = useRef<ChatRequest | null>(null);
	const inFlight = useRef(false);

	const setLocation = useCallback((point: GeoPoint | null) => {
		const rounded = normalizeLocation(point);
		locationRef.current = rounded;
		updateLocation(rounded);
		// Revoking location also prevents a failed request from sending it again on retry.
		if (rounded === null && lastRequest.current !== null) {
			lastRequest.current = createChatRequest(lastRequest.current.messages, null);
		}
	}, []);

	const exchange = useCallback(async (request: ChatRequest) => {
		if (inFlight.current) return;
		inFlight.current = true;
		lastRequest.current = request;
		setStatus('sending');
		setError(null);

		try {
			const response = await fetch('/api/chat', {
				body: JSON.stringify(request),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
			});

			if (!response.ok) {
				// The route answers with a sentence meant for a person. Showing "Server said 500"
				// instead would throw that away and tell the reader nothing they can act on.
				const failure: unknown = await response.json().catch(() => null);
				const message =
					typeof failure === 'object' && failure !== null && 'message' in failure
						? String(failure.message)
						: `Сервер ответил ${String(response.status)}.`;

				throw new Error(message);
			}

			const parsed = chatResponseSchema.safeParse(await response.json());

			if (!parsed.success) {
				throw new Error('Ответ сервера не совпал с ожидаемой формой.');
			}

			setMessages([...request.messages, { content: parsed.data.reply, role: 'assistant' }]);
			setToolCalls(parsed.data.toolCalls);
			setStatus('idle');
		} catch (cause) {
			// The user's message stays in the transcript, so retry resends it rather than making
			// somebody retype what they already said.
			setError(cause instanceof Error ? cause.message : 'Не удалось связаться с ассистентом.');
			setStatus('error');
		} finally {
			inFlight.current = false;
		}
	}, []);

	const send = useCallback(
		(content: string) => {
			if (inFlight.current) return;
			const history = [...messages, { content, role: 'user' as const }];

			setMessages(history);
			void exchange(createChatRequest(history, locationRef.current));
		},
		[exchange, messages],
	);

	const retry = useCallback(() => {
		if (lastRequest.current !== null) void exchange(lastRequest.current);
	}, [exchange]);

	return { error, location, messages, retry, send, setLocation, status, toolCalls };
}
