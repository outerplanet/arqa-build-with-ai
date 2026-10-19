import { type ToolCall } from '@server/agent/model/agent.schema';
import { type Candidate } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { summariseToolCall } from './activity';

const call = (name: string, result: unknown): ToolCall => ({
	arguments: {},
	durationMs: 3,
	label: 'Инструмент',
	name,
	result,
	status: 'ok',
});

const place = (id: string, name: string): Candidate['place'] => ({
	address: null,
	category: 'park',
	description: null,
	descriptionSource: null,
	id,
	lat: 51.1,
	lon: 71.4,
	name,
	nameEn: null,
	openingHours: null,
	phone: null,
	popularity: null,
	sourceUrl: `https://www.openstreetmap.org/${id.replace('osm:', '')}`,
	tags: [],
	website: null,
	wheelchair: null,
});

const candidate = (id: string, name: string): Candidate => ({
	distanceM: 100,
	open: { confidence: 'none', note: 'Неизвестно', opensAt: null, status: 'unknown', until: null },
	place: place(id, name),
	score: 0.5,
	visitMinutes: 20,
	walkMinutes: 2,
	why: { distance: 1, open: 0, popularity: 0, semantic: 0.5, tags: [] },
});

const found = [candidate('osm:node/1', 'Парк'), candidate('osm:node/2', 'Сквер'), candidate('osm:node/3', 'Сад')];
const search = (note: string | null) => ({
	candidates: found,
	note,
	origin: { label: 'Байтерек', point: { lat: 51.128, lon: 71.43 }, source: 'text' },
	usedFilters: [],
});

describe('summariseToolCall', () => {
	it('names the resolved point, or says the landmark was not found', () => {
		const resolved = {
			confidence: 'high',
			found: true,
			label: 'Alem.ai (бывший Нур Алем)',
			matchedPlaceId: null,
			point: { lat: 51.09, lon: 71.41 },
		};
		expect(summariseToolCall(call('resolve_location', resolved))).toBe('Точка: Alem.ai (бывший Нур Алем)');
		expect(summariseToolCall(call('resolve_location', { ...resolved, found: false, label: null, point: null }))).toBe(
			'Ориентир не найден',
		);
	});

	it('counts found and shown places and flags a lexical search', () => {
		expect(summariseToolCall(call('find_places', search(null)), ['osm:node/1', 'osm:node/3'])).toBe(
			'Найдено 3 места, показано 2',
		);
		expect(summariseToolCall(call('find_places', search('Использован лексический поиск без эмбеддингов.')))).toBe(
			'Найдено 3 места, показано 0 · лексический поиск, без эмбеддингов',
		);
		expect(summariseToolCall(call('find_places', { ...search(null), candidates: [] }))).toBe(
			'Подходящих мест не найдено',
		);
	});

	it('gives the route stop count and its minutes', () => {
		const plan = {
			legs: [],
			note: 'Оценка',
			stops: found.slice(0, 2).map((item, index) => ({ arriveAtMinute: 5, candidate: item, order: index + 1 })),
			totalMinutes: 74.2,
		};
		expect(summariseToolCall(call('plan_walk', plan))).toBe('Маршрут: 2 остановки, ≈ 75 мин');
	});

	it('names the place and reads the clock', () => {
		expect(summariseToolCall(call('get_place', place('osm:way/7', 'Хан Шатыр')))).toBe('Хан Шатыр');
		expect(
			summariseToolCall(
				call('get_current_time', {
					iso: '2026-10-19T13:20:00Z',
					local: '19 октября, 18:20',
					timeZone: 'Asia/Almaty',
				}),
			),
		).toBe('Сейчас: 19 октября, 18:20 (Asia/Almaty)');
	});

	it('shows a public error as is and never guesses from an unparsed result', () => {
		expect(summariseToolCall({ ...call('find_places', 'Не удалось проверить места.'), status: 'error' })).toBe(
			'Не удалось проверить места.',
		);
		expect(summariseToolCall(call('find_places', { candidates: 'x' }))).toBe('Ответ получен — подробности ниже');
	});
});
