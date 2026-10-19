import { type ToolCall } from '@server/agent/model/agent.schema';
import { type Candidate, type WalkPlan } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { placesFromToolCalls } from './places';
import { createChatRequest, normalizeLocation } from './request';

const point = { lat: 51.128, lon: 71.43 };
const candidate: Candidate = {
	distanceM: 150,
	open: { confidence: 'none', note: 'часы работы неизвестны', opensAt: null, status: 'unknown', until: null },
	place: {
		...point,
		address: null,
		category: 'monument',
		description: null,
		descriptionSource: null,
		id: 'osm:node/1',
		name: 'Тестовое место',
		nameEn: null,
		openingHours: null,
		phone: null,
		popularity: null,
		sourceUrl: 'https://www.openstreetmap.org/node/1',
		tags: [],
		website: null,
		wheelchair: null,
	},
	score: 0.5,
	visitMinutes: 15,
	walkMinutes: 3,
	why: { distance: 0.5, open: 0.5, popularity: 0, semantic: 0.5, tags: [] },
};
const found = {
	candidates: [candidate],
	note: null,
	origin: { label: null, point, source: 'browser' },
	usedFilters: [],
};
const plan: WalkPlan = {
	legs: [{ distanceM: 150, from: point, to: { lat: 51.13, lon: 71.432 }, walkMinutes: 3 }],
	note: 'Оценка времени',
	stops: [{ arriveAtMinute: 3, candidate, order: 1 }],
	totalMinutes: 18,
};
function call(name: string, result: unknown, status: ToolCall['status'] = 'ok'): ToolCall {
	return { arguments: {}, durationMs: 1, label: 'Поиск', name, result, status };
}

describe('places from reported tool results', () => {
	it('accepts validated places and their reported origin', () => {
		expect(placesFromToolCalls([call('find_places', found)])).toEqual({
			candidates: [candidate],
			origin: point,
			plan: null,
		});
	});
	it('takes stops and legs only from a successful validated route', () => {
		expect(placesFromToolCalls([call('find_places', found), call('plan_walk', plan)])).toEqual({
			candidates: [candidate],
			origin: point,
			plan,
		});
	});
	it('ignores failed, malformed and unrelated tool payloads', () => {
		for (const calls of [
			[],
			[call('find_places', found, 'error')],
			[call('plan_walk', plan, 'error')],
			[call('get_place', candidate)],
			[call('find_places', { ...found, candidates: [{ ...candidate, place: { ...candidate.place, lat: 91 } }] })],
			[call('plan_walk', { ...plan, legs: [{ from: point }] })],
		])
			expect(placesFromToolCalls(calls)).toEqual({ candidates: [], origin: null, plan: null });
	});
	it('uses the latest valid result and clears an earlier route for empty search results', () => {
		expect(placesFromToolCalls([call('plan_walk', plan), call('find_places', { ...found, candidates: [] })])).toEqual(
			{
				candidates: [],
				origin: point,
				plan: null,
			},
		);
		expect(placesFromToolCalls([call('find_places', found), call('find_places', null)])).toEqual({
			candidates: [candidate],
			origin: point,
			plan: null,
		});
	});
	it('does not invent an origin for an empty route', () => {
		const empty = { ...plan, legs: [], stops: [], totalMinutes: 0 };
		expect(placesFromToolCalls([call('plan_walk', empty)])).toEqual({ candidates: [], origin: null, plan: empty });
	});
});

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
