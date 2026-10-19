import { describe, expect, it } from 'vitest';
import { createChatRequest, normalizeLocation } from './request';

const point = { lat: 51.128, lon: 71.43 };

describe('browser location request boundary', () => {
	it('revokes coordinates from a retry snapshot while retaining the sent history', () => {
		const sent = createChatRequest([{ content: 'Где погулять?', role: 'user' }], point);
		const revoked = createChatRequest(sent.messages, null);
		expect(revoked).toEqual({ messages: sent.messages });
		expect(revoked).not.toHaveProperty('location');
		expect(sent.location).toEqual(point);
	});
	it('validates and rounds before location enters state or a request', () => {
		expect(normalizeLocation({ lat: 51.123456, lon: 71.987654 })).toEqual({ lat: 51.123, lon: 71.988 });
		for (const invalid of [null, { lat: NaN, lon: 71 }, { lat: 91, lon: 71 }, { lat: 51, lon: Infinity }]) {
			expect(normalizeLocation(invalid)).toBeNull();
		}
	});
	it('omits unapproved location and snapshots rounded coordinates for retries', () => {
		const messages = [{ content: 'Хочу гулять', role: 'user' as const }];
		expect(createChatRequest(messages, null)).toEqual({ messages });
		const location = { lat: 51.123456, lon: 71.987654 };
		const snapshot = createChatRequest(messages, location);
		location.lat = 50;
		messages[0]!.content = 'Другой запрос';
		expect(snapshot).toEqual({
			location: { lat: 51.123, lon: 71.988 },
			messages: [{ content: 'Хочу гулять', role: 'user' }],
		});
	});
});
