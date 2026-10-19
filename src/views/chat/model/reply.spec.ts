import { type Candidate, type FindPlacesResult } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { buildPlaceCards, type Recommendation, summariseReply } from './reply';

function candidate([id, name]: [string, string], status: 'open' | 'unknown' = 'unknown'): Candidate {
	return {
		distanceM: 562,
		open: {
			confidence: 'high',
			note: 'Часы из OpenStreetMap',
			opensAt: null,
			status,
			until: status === 'open' ? '22:00' : null,
		},
		place: {
			address: null,
			category: 'cafe',
			description: null,
			descriptionSource: null,
			id,
			lat: 51.09,
			lon: 71.41,
			name,
			nameEn: null,
			openingHours: null,
			phone: null,
			popularity: null,
			sourceUrl: `https://www.openstreetmap.org/${id.replace('osm:', '')}`,
			tags: [],
			website: null,
			wheelchair: null,
		},
		score: 0.5,
		visitMinutes: 40,
		walkMinutes: 10,
		why: { distance: 1, open: 0, popularity: 0, semantic: 0.5, tags: [] },
	};
}

const first = candidate(['osm:node/1', 'Кофейня Утро'], 'open');
const second = candidate(['osm:node/2', 'Библиотека']);

const REPLY = [
	'Локация: Alem.ai (из ваших слов).',
	'Фильтры: Пешком до 15 мин; Часы проверены на 18:20 по Астане.',
	'Время дороги в аэропорт неизвестно — проверьте его.',
	'1. Кофейня Утро — 562 м, 10 мин пешком (оценка).\nПочему: кафе — совпадает с запросом «кофе», 10 мин пешком.\nНа посещение: 40 мин (оценка).\nЧто делать: выпить кофе и отдохнуть (сгенерированная идея).\nЧасы: открыто до 22:00 по данным OpenStreetMap.\nИсточник места: [OpenStreetMap](https://www.openstreetmap.org/node/1).',
	'2. Библиотека — 800 м, 12 мин пешком (оценка).\nПочему: библиотека, 12 мин пешком.\nЧасы: часы работы неизвестны — уточните перед выходом.',
].join('\n\n');

const search: FindPlacesResult = {
	candidates: [first, second],
	note: null,
	origin: { label: 'Alem.ai', point: { lat: 51.089, lon: 71.416 }, source: 'text' },
	usedFilters: [],
};

describe('buildPlaceCards', () => {
	it('reads the server wording back out of the reply when no structured recommendations came', () => {
		const [card, other] = buildPlaceCards({ candidates: [first, second], reply: REPLY });
		expect(card).toMatchObject({
			action: 'выпить кофе и отдохнуть',
			distanceM: 562,
			hours: 'открыто до 22:00 по данным OpenStreetMap',
			hoursStatus: 'open',
			order: 1,
			visitMinutes: 40,
			why: 'кафе — совпадает с запросом «кофе», 10 мин пешком',
		});
		expect(other).toMatchObject({ action: null, hours: 'часы работы неизвестны — уточните перед выходом', order: 2 });
	});

	it('never shows a place as open from text alone: unknown status keeps its unknown hours', () => {
		const lying = REPLY.replace('часы работы неизвестны — уточните перед выходом', 'открыто сейчас');
		expect(buildPlaceCards({ candidates: [second], reply: lying })[0]?.hoursStatus).toBe('unknown');
	});

	it('prefers structured recommendations, in their order, and drops ids no tool returned', () => {
		const recommendations: Recommendation[] = [
			{
				action: 'почитать',
				distanceM: 800,
				hours: 'часы работы неизвестны — уточните перед выходом',
				order: 2,
				placeId: second.place.id,
				visitMinutes: 30,
				walkMinutes: 12,
				why: 'тихо',
			},
			{
				action: 'кофе (сгенерированная идея)',
				distanceM: 562,
				hours: 'открыто до 22:00',
				order: 1,
				placeId: first.place.id,
				visitMinutes: 40,
				walkMinutes: 10,
				why: 'рядом',
			},
			{
				action: 'x',
				distanceM: 1,
				hours: 'открыто',
				order: 3,
				placeId: 'osm:node/999',
				visitMinutes: 1,
				walkMinutes: 1,
				why: 'выдумано',
			},
		];
		const cards = buildPlaceCards({ candidates: [first, second], recommendations, reply: '' });
		expect(cards.map((card) => card.candidate.place.id)).toEqual([first.place.id, second.place.id]);
		expect(cards[0]?.action).toBe('кофе');
		expect(cards[1]?.why).toBe('тихо');
	});

	it('falls back to the tool result when the reply has no block for a place', () => {
		expect(buildPlaceCards({ candidates: [second], reply: 'Короткий ответ.' })[0]).toMatchObject({
			hours: 'часы работы неизвестны — уточните перед выходом',
			why: null,
		});
	});
});

describe('summariseReply', () => {
	it('says how many places, near what, where the location came from and the filters', () => {
		expect(summariseReply({ count: 2, plan: null, reply: REPLY, search })).toEqual({
			filters: ['Пешком до 15 мин', 'Часы проверены на 18:20 по Астане'],
			headline: 'Нашёл 2 места рядом с Alem.ai',
			notes: ['Время дороги в аэропорт неизвестно — проверьте его.'],
			source: 'из ваших слов',
		});
	});

	it('declines numbers and names an empty result', () => {
		expect(summariseReply({ count: 1, plan: null, reply: '', search }).headline).toBe(
			'Нашёл 1 место рядом с Alem.ai',
		);
		expect(summariseReply({ count: 5, plan: null, reply: '', search: null }).headline).toBe('Нашёл 5 мест');
		expect(
			summariseReply({ count: 0, plan: null, reply: 'Фильтры: дополнительные не заданы.', search: null }),
		).toMatchObject({
			filters: [],
			headline: 'Подходящих мест не нашлось',
		});
	});
});
