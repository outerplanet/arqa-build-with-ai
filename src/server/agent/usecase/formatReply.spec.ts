import { formatRecommendations, formatWalk } from '@server/agent/usecase/formatReply';
import { type Candidate, type FindPlacesResult } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';

function candidate(status: Candidate['open']['status'], name = 'Тестовый парк'): Candidate {
	return {
		distanceM: 400,
		open: { confidence: 'none', note: 'Тестовые часы', opensAt: null, status, until: null },
		place: {
			address: null,
			category: 'park',
			description: null,
			descriptionSource: null,
			id: 'osm:node/1',
			lat: 51,
			lon: 71,
			name,
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
		walkMinutes: 5,
		why: { distance: 1, open: 0, popularity: 0, semantic: 0, tags: [] },
	};
}

function result(candidates: Candidate[]): FindPlacesResult {
	return {
		candidates,
		note: null,
		origin: { label: 'Тестовая точка', point: { lat: 51, lon: 71 }, source: 'browser' },
		usedFilters: ['пешком до 15 минут'],
	};
}

describe('formatRecommendations', () => {
	it('discloses unknown hours, source, origin, filters and generated suggestions', () => {
		const reply = formatRecommendations(result([candidate('unknown')]));
		expect(reply).toContain('часы работы неизвестны — уточните перед выходом');
		expect(reply).toContain('OpenStreetMap');
		expect(reply).toContain('браузера');
		expect(reply).toContain('пешком до 15 минут');
		expect(reply).toContain('сгенерированная идея');
		expect(reply).toContain('400 м');
		expect(reply).toContain('5 мин');
		expect(reply).not.toContain('24/7');
		expect(reply).not.toContain('тихий');
	});

	it('limits to three actual candidates and two before a flight', () => {
		const places = [1, 2, 3, 4].map((n) => candidate('open', `Место ${n}`));
		expect(formatRecommendations(result(places))).not.toContain('Место 4');
		const reply = formatRecommendations(result(places), { flight: true });
		expect(reply).not.toContain('Место 3');
		expect(reply).toContain('Время дороги в аэропорт');
		expect(reply).toContain('неизвестно');
	});

	it('only recommends verified open places at night and discloses exclusions', () => {
		const reply = formatRecommendations(
			result([candidate('closed', 'Закрытый'), candidate('unknown', 'Неизвестный'), candidate('open', 'Открытый')]),
			{ night: true },
		);
		expect(reply).toContain('Открытый');
		expect(reply).not.toContain('Закрытый');
		expect(reply).not.toContain('Неизвестный');
		expect(reply).toContain('часы работы неизвестны');
	});

	it('labels a generated description separately from the place source', () => {
		const place = candidate('unknown');
		place.place.description = 'Описание для теста';
		place.place.descriptionSource = 'generated';
		expect(formatRecommendations(result([place]))).toContain('Описание для теста (сгенерированная идея)');
	});
});

describe('formatWalk', () => {
	it('uses the plan minutes, stop hours, source and note', () => {
		const reply = formatWalk({
			legs: [{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 5 }],
			note: 'Расстояние приблизительное',
			stops: [{ arriveAtMinute: 5, candidate: candidate('unknown'), order: 1 }],
			totalMinutes: 25,
		});
		expect(reply).toContain('25 мин');
		expect(reply).toContain('5 мин');
		expect(reply).toContain('20 мин');
		expect(reply).toContain('часы работы неизвестны');
		expect(reply).toContain('OpenStreetMap');
		expect(reply).toContain('Расстояние приблизительное');
	});
});
