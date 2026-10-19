import { type ToolCall } from '@server/agent/model/agent.schema';
import { type Candidate } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { buildChatRequest, readPlacesResults } from './results';

const call = (name: string, result: unknown): ToolCall => ({
	arguments: {},
	durationMs: 1,
	label: 'Поиск',
	name,
	result,
	status: 'ok',
});

describe('map result boundary', () => {
	const candidate: Candidate = {
		distanceM: 100,
		open: { confidence: 'none', note: 'Неизвестно', opensAt: null, status: 'unknown', until: null },
		place: {
			address: null,
			category: 'park',
			description: null,
			descriptionSource: null,
			id: 'osm:node/1',
			lat: 51.1,
			lon: 71.4,
			name: 'Парк',
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
		visitMinutes: 20,
		walkMinutes: 2,
		why: { distance: 1, open: 0, popularity: 0, semantic: 0.5, tags: [] },
	};
	it('uses route order, deduplicates search results and rejects a valid but failed tool', () => {
		const search = {
			candidates: [candidate],
			note: null,
			origin: { label: null, point: { lat: 51.1, lon: 71.4 }, source: 'browser' },
			usedFilters: [],
		};
		const plan = {
			legs: [],
			note: 'По прямой',
			stops: [{ arriveAtMinute: 2, candidate, order: 1 }],
			totalMinutes: 22,
		};
		expect(readPlacesResults([call('find_places', search), call('plan_walk', plan)]).candidates).toEqual([candidate]);
		expect(readPlacesResults([{ ...call('find_places', search), status: 'error' }]).candidates).toEqual([]);
	});
	it('rejects malformed or failed results instead of inventing coordinates', () => {
		expect(
			readPlacesResults([
				call('find_places', { candidates: [{ place: { lat: 51, lon: 71 } }] }),
				{ ...call('plan_walk', {}), status: 'error' },
			]).candidates,
		).toEqual([]);
	});
	it('keeps the validated origin and filters, including an empty search', () => {
		const result = {
			candidates: [],
			note: 'Нет подходящих мест',
			origin: { label: 'Экспо', point: { lat: 51.09, lon: 71.4 }, source: 'text' },
			usedFilters: ['пешком'],
		};
		expect(readPlacesResults([call('find_places', result)]).search).toEqual(result);
	});
	it('ignores place-shaped values from unrelated tools', () => {
		expect(readPlacesResults([call('get_current_time', { candidates: [] })]).search).toBeNull();
	});
});

describe('browser request privacy', () => {
	it('rounds coordinates before serialisation without changing the input', () => {
		const location = { lat: 51.1234567, lon: 71.9876543 };
		expect(buildChatRequest([{ content: 'Прогулка', role: 'user' }], location).location).toEqual({
			lat: 51.123,
			lon: 71.988,
		});
		expect(location.lat).toBe(51.1234567);
	});
	it('omits location until the user shares it', () => {
		expect(buildChatRequest([{ content: 'Прогулка', role: 'user' }])).not.toHaveProperty('location');
	});
});
