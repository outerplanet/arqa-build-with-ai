import { formatRecommendations, formatWalk } from '@server/agent/usecase/formatReply';
import { answerForTools, recommendedPlaceIdsForTools, replyForTools } from '@server/agent/usecase/reply';
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

	it('builds «почему» from the matched interest, OSM tags, open status and walk time', () => {
		const cafe = candidate('open', 'Кофейня');
		cafe.place.category = 'cafe';
		cafe.place.tags = ['wifi'];
		cafe.why.tags = ['wifi'];
		cafe.walkMinutes = 3;
		cafe.open = {
			confidence: 'high',
			note: 'по данным OSM открыто до 22:00',
			opensAt: null,
			status: 'open',
			until: '22:00',
		};
		const reply = formatRecommendations(result([cafe]), {
			categories: ['cafe', 'library'],
			interests: ['кофе'],
		});

		expect(reply).toContain(
			'Почему: кафе — совпадает с запросом «кофе», по данным OSM есть Wi-Fi, открыто до 22:00, 3 мин пешком.',
		);
		expect(reply).not.toContain('от отправной точки');
	});

	it('never says «открыто» in the reason without an open status', () => {
		const reply = formatRecommendations(result([candidate('unknown')]), { interests: ['прогулка'] });
		const why = reply.split('\n').find((line) => line.startsWith('Почему:'));

		expect(why).toBeDefined();
		expect(why).not.toContain('открыто');
	});

	it('states the hours once, in one sentence, and says low confidence aloud', () => {
		const open = candidate('open');
		open.open = {
			confidence: 'high',
			note: 'по данным OSM открыто до 00:00',
			opensAt: null,
			status: 'open',
			until: '00:00',
		};
		const reply = formatRecommendations(result([open]));

		expect(reply).toContain('Часы: открыто до 00:00 по данным OpenStreetMap.');
		expect(reply).not.toContain('по данным OSM открыто');
		expect(reply).not.toContain('открыто по данным источника');

		const partial = candidate('open');
		partial.open = {
			confidence: 'low',
			note: 'по данным OSM открыто до 18:00',
			opensAt: null,
			status: 'open',
			until: '18:00',
		};
		expect(formatRecommendations(result([partial]))).toContain('уверенность низкая');
		expect(formatRecommendations(result([candidate('unknown')]))).toContain(
			'Часы: часы работы неизвестны — уточните перед выходом.',
		);
	});

	it('shows parsed filters and the check time instead of the raw conversation', () => {
		const found = result([candidate('open')]);
		found.usedFilters = [
			'Запрос: Я у Нур Алем, хочу что-то необычное',
			'Пешком до 15 минут',
			'Время проверки: 2026-10-19T10:00:00.000Z',
		];
		const reply = formatRecommendations(found, { interests: ['необычное'] });

		expect(reply).not.toContain('Я у Нур Алем');
		expect(reply).toContain('Интерес: необычное');
		expect(reply).toContain('Часы проверены на 15:00 по Астане');
		expect(reply).not.toContain('2026-10-19T10:00');
	});

	it('says what time the hours were checked for when night is asked during the day', () => {
		const reply = formatRecommendations(result([candidate('open')]), {
			night: true,
			now: new Date('2026-10-19T10:00:00.000Z'),
		});

		expect(reply).toContain('Сейчас 15:00 по Астане — часы проверены на это время');
		expect(
			formatRecommendations(result([candidate('open')]), { night: true, now: new Date('2026-10-19T18:30:00.000Z') }),
		).not.toContain('Сейчас 23:30');
	});

	it('keeps a walk without a stated interest to at most one cafe', () => {
		const cafes = [1, 2, 3].map((n) => {
			const item = candidate('open', `Кафе ${n}`);
			item.place.category = 'cafe';
			item.place.id = `osm:node/${n}`;
			return item;
		});
		const park = candidate('open', 'Парк');
		park.place.id = 'osm:node/9';
		const reply = formatRecommendations(result([...cafes, park]), { walk: true });

		expect(reply).toContain('Кафе 1');
		expect(reply).not.toContain('Кафе 2');
		expect(reply).toContain('Парк');
		expect(reply).toContain('Почему: парк — подходит для прогулки');
		expect(reply).toContain('Почему: кафе — остановка на кофе');
	});

	it('does not recommend the landmark the user is standing at', () => {
		const here = candidate('open', 'Нур Алем');
		const next = candidate('open', 'Соседний музей');
		next.place.id = 'osm:node/2';
		const ids = recommendedPlaceIdsForTools({
			messages: [{ content: 'Я у Нур Алем, хочу что-то необычное', role: 'user' }],
			toolCalls: [
				{
					arguments: {},
					durationMs: 1,
					label: 'Локация',
					name: 'resolve_location',
					result: {
						confidence: 'high',
						found: true,
						label: 'Нур Алем',
						matchedPlaceId: 'osm:node/1',
						point: { lat: 51, lon: 71 },
					},
					status: 'ok',
				},
				{
					arguments: {},
					durationMs: 1,
					label: 'Поиск',
					name: 'find_places',
					result: result([here, next]),
					status: 'ok',
				},
			],
		});

		expect(ids).toEqual(['osm:node/2']);
	});

	it('quotes a short Wikidata description in «почему» once, instead of a separate line', () => {
		const museum = candidate('unknown', 'Национальный музей');
		museum.place.category = 'museum';
		museum.place.description = 'крупнейший музей страны';
		museum.place.descriptionSource = 'wikidata';
		const reply = formatRecommendations(result([museum]), { categories: ['museum'], interests: ['музей'] });

		expect(reply).toContain(
			'Почему: музей — совпадает с запросом «музей», описание Wikidata: «крупнейший музей страны»',
		);
		expect(reply.split('крупнейший музей страны')).toHaveLength(2);
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
	it('builds route filters from the parsed request, never from the raw conversation', () => {
		const reply = replyForTools(
			{ ...createCtx(), browserLocation: { lat: 51, lon: 71 } },
			{
				messages: [{ content: 'Построй маршрут на час', role: 'user' }],
				toolCalls: [
					{
						arguments: {},
						durationMs: 1,
						label: 'Маршрут',
						name: 'plan_walk',
						result: {
							legs: [
								{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 5 },
							],
							note: '',
							stops: [{ arriveAtMinute: 5, candidate: candidate('open'), order: 1 }],
							totalMinutes: 25,
						},
						status: 'ok',
					},
				],
			},
		);
		const filters = reply.split('\n').find((line) => line.startsWith('Фильтры:'));

		expect(filters).toBeDefined();
		expect(filters).not.toContain('Построй маршрут');
		// The whole budget and the per-leg limit are named apart, so neither reads as the other.
		expect(filters).toContain('Вся прогулка — до 60 мин, включая переходы и посещения');
		expect(filters).toContain('один переход — до 15 мин пешком');
	});

	it('describes route legs from the plan instead of a contradicting walk limit', () => {
		const far = candidate('unknown');
		far.distanceM = 2600;
		far.walkMinutes = 27;
		const found = result([far]);
		found.usedFilters = ['Запрос: Построй маршрут на 90 минут', 'Пешком до 15 минут'];
		const reply = replyForTools(
			{ ...createCtx(), browserLocation: { lat: 51, lon: 71 } },
			{
				messages: [{ content: 'Построй маршрут на 90 минут', role: 'user' }],
				toolCalls: [
					{ arguments: {}, durationMs: 1, label: 'Поиск', name: 'find_places', result: found, status: 'ok' },
					{
						arguments: {},
						durationMs: 1,
						label: 'Маршрут',
						name: 'plan_walk',
						result: {
							legs: [
								{ distanceM: 2100, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 27 },
							],
							note: '',
							stops: [{ arriveAtMinute: 27, candidate: far, order: 1 }],
							totalMinutes: 67,
						},
						status: 'ok',
					},
				],
			},
		);

		expect(reply).not.toContain('Пешком до 15 минут');
		expect(reply).toContain('Переход: 2100 м, 27 мин');
		expect(reply).toContain('переход 27 мин');
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

	it('says plainly when the requested number of stops does not fit', () => {
		const reply = formatWalk(
			{
				legs: [{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51.01, lon: 71 }, walkMinutes: 5 }],
				note: '',
				stops: [{ arriveAtMinute: 5, candidate: candidate('unknown'), order: 1 }],
				totalMinutes: 25,
			},
			{ durationMinutes: 30, stops: { max: 3, min: 3 } },
		);

		expect(reply).toContain(
			'Три места за 30 мин не помещаются с учётом переходов и посещений — в маршруте 1 остановка.',
		);
	});
});

/** Every numbered item in the text, split into the fields a card shows. */
function textItems(reply: string) {
	return reply
		.split('\n\n')
		.filter((part) => /^\d+\. /u.test(part))
		.map((part) => ({
			action: /^Что делать: (.+) \(сгенерированная идея\)\.$/mu.exec(part)?.[1],
			hours: /^Часы: (.+)\.$/mu.exec(part)?.[1],
			order: Number(/^(\d+)\. /u.exec(part)?.[1]),
			visitMinutes: Number(/^На посещение: (\d+) мин/mu.exec(part)?.[1]),
			why: /^Почему: (.+)\.$/mu.exec(part)?.[1],
		}));
}

describe('structured recommendations', () => {
	function searchCall(candidates: Candidate[]) {
		return {
			arguments: {},
			durationMs: 1,
			label: 'Поиск',
			name: 'find_places',
			result: result(candidates),
			status: 'ok' as const,
		};
	}
	const ctx = { ...createCtx(), browserLocation: { lat: 51, lon: 71 } };

	it('carries the same places, order and words as the text reply for a search', () => {
		const items = ['Музей Тест', 'Галерея Тест', 'Парк Тест', 'Сад Тест'].map((name, index) => {
			const item = candidate(index === 0 ? 'open' : 'unknown', name);
			item.place.id = `osm:node/${index + 1}`;
			item.distanceM = 300 + index * 100;
			item.walkMinutes = 5 + index;
			return item;
		});
		const input = { messages: [{ content: 'Хочу в парк', role: 'user' as const }], toolCalls: [searchCall(items)] };
		const answer = answerForTools(ctx, input);

		expect(answer.recommendations).toHaveLength(3);
		expect(answer.recommendedPlaceIds).toEqual(answer.recommendations!.map((item) => item.placeId));
		expect(recommendedPlaceIdsForTools(input)).toEqual(answer.recommendedPlaceIds);
		expect(textItems(answer.reply)).toEqual(
			answer.recommendations!.map(({ action, hours, order, visitMinutes, why }) => ({
				action,
				hours,
				order,
				visitMinutes,
				why,
			})),
		);
		for (const item of answer.recommendations!) {
			expect(item.action).not.toContain('сгенерированная идея');
			expect(answer.reply).toContain(`${Math.round(item.distanceM)} м, ${item.walkMinutes} мин пешком`);
		}
	});

	it('uses stop order and leg minutes for a route, and says the network caveat once', () => {
		const first = candidate('unknown', 'Парк Первый');
		const second = candidate('unknown', 'Музей Второй');
		second.place.id = 'osm:node/2';
		second.place.category = 'museum';
		const answer = answerForTools(ctx, {
			messages: [{ content: 'Построй маршрут на час', role: 'user' }],
			toolCalls: [
				{
					arguments: {},
					durationMs: 1,
					label: 'Маршрут',
					name: 'plan_walk',
					result: {
						legs: [
							{ distanceM: 400, from: { lat: 51, lon: 71 }, to: { lat: 51, lon: 71 }, walkMinutes: 6 },
							{ distanceM: 250, from: { lat: 51, lon: 71 }, to: { lat: 51, lon: 71 }, walkMinutes: 4 },
						],
						note: '',
						stops: [
							{ arriveAtMinute: 6, candidate: first, order: 1 },
							{ arriveAtMinute: 30, candidate: second, order: 2 },
						],
						totalMinutes: 50,
						walkingRoute: { note: 'Путь по пешеходным дорожкам OpenStreetMap.', status: 'unavailable' },
					},
					status: 'ok',
				},
			],
		});

		expect(
			answer.recommendations?.map((item) => [item.order, item.placeId, item.distanceM, item.walkMinutes]),
		).toEqual([
			[1, 'osm:node/1', 400, 6],
			[2, 'osm:node/2', 250, 4],
		]);
		expect(answer.recommendedPlaceIds).toEqual(['osm:node/1', 'osm:node/2']);
		expect(textItems(answer.reply).map((item) => item.why)).toEqual(answer.recommendations!.map((item) => item.why));
		expect(answer.reply.split('пешеходным дорожкам')).toHaveLength(2);
	});

	it('omits recommendations when nothing is recommended', () => {
		const answer = answerForTools(ctx, {
			messages: [{ content: 'Есть только 10 минут', role: 'user' }],
			toolCalls: [searchCall([candidate('unknown')])],
		});

		expect(answer.recommendations).toBeUndefined();
		expect(answer.recommendedPlaceIds).toEqual([]);
	});

	it('never offers a generic-named square as a sight while a named place is within reach', () => {
		const square = candidate('unknown', 'Сквер');
		square.score = 0.9;
		const monument = candidate('unknown', 'Памятник Тест');
		monument.place.id = 'osm:node/2';
		monument.place.category = 'monument';
		const answer = answerForTools(ctx, {
			messages: [{ content: 'Я турист, что можно посмотреть?', role: 'user' }],
			toolCalls: [searchCall([square, monument])],
		});

		expect(answer.recommendedPlaceIds).toEqual(['osm:node/2']);
		expect(answer.recommendations![0]!.why).toContain('совпадает с запросом «достопримечательности»');
		expect(answer.reply).not.toMatch(/^\d+\. Сквер/mu);
	});

	it('keeps a generic-named park only when nothing else is within reach, without calling it a sight', () => {
		const answer = answerForTools(ctx, {
			messages: [{ content: 'Я турист, что можно посмотреть?', role: 'user' }],
			toolCalls: [searchCall([candidate('unknown', 'Сквер')])],
		});

		expect(answer.recommendations![0]!.why).not.toContain('совпадает');
		expect(answer.reply).toContain('мало музеев, галерей и арт-объектов');
	});

	it('lists night answers from the nearest and says so', () => {
		const far = candidate('open', 'Бар Дальний');
		far.score = 0.9;
		far.distanceM = 900;
		const near = candidate('open', 'Бар Ближний');
		near.place.id = 'osm:node/2';
		near.distanceM = 200;
		const answer = answerForTools(ctx, {
			messages: [{ content: 'Что открыто ночью?', role: 'user' }],
			toolCalls: [searchCall([far, near])],
		});

		expect(answer.recommendedPlaceIds).toEqual(['osm:node/2', 'osm:node/1']);
		expect(answer.reply).toContain('от ближнего к дальнему');
	});
});
