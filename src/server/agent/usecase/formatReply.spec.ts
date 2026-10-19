import { formatRecommendations, formatWalk } from '@server/agent/usecase/formatReply';
import { recommendedPlaceIdsForTools, replyForTools } from '@server/agent/usecase/reply';
import { createCtx } from '@server/kernel/ctx';
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
	it('gives the map exactly the eligible recommendations from the text, capped at three', () => {
		const candidates = ['unknown', 'open', 'open', 'open', 'open'].map((status, index) => {
			const item = candidate(status as Candidate['open']['status']);
			item.place.id = `osm:node/${index + 1}`;
			return item;
		});
		const input = {
			messages: [{ content: 'Что открыто ночью на 30 минут?', role: 'user' as const }],
			toolCalls: [
				{
					arguments: {},
					durationMs: 1,
					label: 'Поиск',
					name: 'find_places',
					result: result(candidates),
					status: 'ok' as const,
				},
			],
		};
		expect(recommendedPlaceIdsForTools(input)).toEqual(['osm:node/2', 'osm:node/3', 'osm:node/4']);
		expect(
			recommendedPlaceIdsForTools({ ...input, messages: [{ content: 'Есть только 10 минут', role: 'user' }] }),
		).toEqual([]);
	});
	it('discloses missing requested facilities instead of inferring sockets or quietness', () => {
		const reply = formatRecommendations(result([candidate('unknown')]), {
			query: 'Хочу тихое место с розеткой и Wi-Fi',
		});

		expect(reply).toContain('Розетки: данных нет');
		expect(reply).toContain('Wi-Fi: данных нет');
		expect(reply).toContain('Уровень шума не проверен');
	});

	it('only confirms a requested facility when the source has its explicit tag', () => {
		const tagged = candidate('open');
		tagged.place.tags = ['power_sockets'];
		const reply = formatRecommendations(result([tagged]), { query: 'кофе с розеткой' });

		expect(reply).toContain('Розетки: отмечены в OpenStreetMap');
		expect(reply).not.toContain('Розетки: данных нет');
	});

	it('does not recommend a visit that exceeds the explicit walking and visit budget', () => {
		const reply = formatRecommendations(result([candidate('open', 'Слишком длинное посещение')]), {
			durationMinutes: 10,
		});

		expect(reply).not.toContain('Слишком длинное посещение');
		expect(reply).toContain('Подходящих мест');
	});

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
	it('labels a single stop as a fallback instead of promising a route with several places', () => {
		expect(
			formatWalk({
				legs: [{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 5 }],
				note: '',
				stops: [{ arriveAtMinute: 5, candidate: candidate('open'), order: 1 }],
				totalMinutes: 25,
			}),
		).toContain('Предложена одна остановка');
	});
	it('renders a successful plan even when its internal search is not a separate tool call', () => {
		const input = {
			messages: [{ content: 'Построй маршрут на час', role: 'user' as const }],
			toolCalls: [
				{
					arguments: {},
					durationMs: 1,
					label: 'Маршрут',
					name: 'plan_walk',
					result: {
						legs: [{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 5 }],
						note: 'По прямой',
						stops: [{ arriveAtMinute: 5, candidate: candidate('open'), order: 1 }],
						totalMinutes: 25,
					},
					status: 'ok' as const,
				},
			],
		};
		expect(recommendedPlaceIdsForTools(input)).toEqual(['osm:node/1']);
		expect(replyForTools({ ...createCtx(), browserLocation: { lat: 51, lon: 71 } }, input)).toContain(
			'Предложена одна остановка: всего 25 мин',
		);
	});
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
