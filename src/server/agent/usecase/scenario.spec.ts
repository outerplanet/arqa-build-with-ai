import { categoriesFor, scenarioFor } from '@server/agent/usecase/scenario';
import { describe, expect, it } from 'vitest';

describe('scenarioFor', () => {
	it('uses the newest explicit budget and interest while preserving an unspecified interest', () => {
		expect(scenarioFor('Я у Mega, хочу гулять 30–60 минут\nПострой маршрут на 2 часа')).toMatchObject({
			categories: expect.arrayContaining(['park', 'garden', 'monument']),
			durationMinutes: 120,
			route: true,
			walk: true,
		});
		expect(scenarioFor('Хочу кофе на час\nТеперь хочу музей на 20 минут')).toMatchObject({
			categories: ['museum', 'gallery'],
			durationMinutes: 20,
		});
	});
	it('searches nightlife categories for an unusual night request instead of daytime museums', () => {
		const scenario = scenarioFor('Ищу необычную ночную активность на последние пару часов');

		expect(scenario.categories).toContain('bar');
		expect(scenario.categories).not.toContain('museum');
	});

	it.each([
		['Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.', 120],
		['Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.', 60],
		['У меня полтора часа', 90],
		['Хочу на пару часов погулять', 120],
	])('extracts an explicit visit budget from %s', (text, durationMinutes) => {
		expect(scenarioFor(text).durationMinutes).toBe(durationMinutes);
	});

	it('does not interpret landmark numbers as minutes', () => {
		expect(scenarioFor('Я у Экспо 2017, дом 42').durationMinutes).toBeUndefined();
		expect(scenarioFor('Экспо 2017').maxWalkMinutes).toBe(15);
	});

	it('recognizes coffee and child scenarios without inventing facilities', () => {
		expect(scenarioFor('Хочу тихое место с кофе и розеткой недалеко от меня').categories).toEqual([
			'cafe',
			'library',
		]);
		expect(scenarioFor('Еду с ребёнком — где детские площадки или музей с интерактивами?').categories).toEqual([
			'playground',
			'museum',
			'zoo',
		]);
	});

	it('recognizes flight, night, accessibility and a route followup', () => {
		expect(scenarioFor('Я турист, у меня 2 часа перед вылетом')).toMatchObject({
			durationMinutes: 120,
			flight: true,
		});
		expect(scenarioFor('Ищу необычную ночную активность на последние пару часов').night).toBe(true);
		expect(scenarioFor('Составь маршрут из этих мест, я на коляске')).toMatchObject({
			accessibleOnly: true,
			route: true,
		});
	});

	it('keeps walking time separate from the total visit budget', () => {
		expect(scenarioFor('Кафе в пределах 10 минут пешком на 2 часа')).toMatchObject({
			durationMinutes: 120,
			maxWalkMinutes: 10,
		});
	});

	it('does not increase a short visit budget to the route minimum', () => {
		expect(scenarioFor('У меня только 10 минут').durationMinutes).toBe(10);
	});

	it('parses a Cyrillic hour abbreviation', () => {
		expect(scenarioFor('Хочу погулять на 2 ч').durationMinutes).toBe(120);
		expect(scenarioFor('Есть 1 ч.').durationMinutes).toBe(60);
		expect(scenarioFor('Построй маршрут на час').durationMinutes).toBe(60);
		expect(scenarioFor('Есть полчаса').durationMinutes).toBe(30);
	});

	it('does not turn words of the location phrase into category filters', () => {
		const scenario = scenarioFor('Я у музея Нур Алем, хочу что-то необычное на 1–2 часа');

		expect(scenario.categories).toContain('attraction');
		expect(scenario.categories).not.toEqual(['museum', 'gallery']);
		expect(scenario.interests).toEqual(['необычное']);
		expect(scenario.query).not.toContain('Нур Алем');
		expect(scenarioFor('Я возле галереи, хочу кофе').categories).toEqual(['cafe', 'library']);
		expect(scenarioFor('Я у Байтерека').categories).toBeUndefined();
		// A time budget after «около» is not a location.
		expect(scenarioFor('Хочу кофе, у меня около 2 часов').durationMinutes).toBe(120);
	});

	it('takes night and flight from the latest request, not from any earlier turn', () => {
		expect(scenarioFor('Ищу ночную активность\nХочу кофе').night).toBe(false);
		expect(scenarioFor('Ищу ночную активность\nА поближе?').night).toBe(true);
		expect(scenarioFor('У меня 2 часа перед вылетом\nХочу в музей').flight).toBe(false);
		expect(scenarioFor('У меня 2 часа перед вылетом\nА поближе?').flight).toBe(true);
	});

	it('derives the walking radius from the time budget unless the user set one', () => {
		expect(scenarioFor('Хочу прогуляться 90 минут').maxWalkMinutes).toBe(23);
		expect(scenarioFor('Хочу погулять на 2 часа').maxWalkMinutes).toBe(30);
		expect(scenarioFor('Хочу кофе на 30 минут').maxWalkMinutes).toBe(10);
		expect(scenarioFor('Хочу кофе').maxWalkMinutes).toBe(15);
		expect(scenarioFor('Кафе в пределах 10 минут пешком на 2 часа').maxWalkMinutes).toBe(10);
	});

	it('defaults a walk or route without interests to sights and parks, never fast food', () => {
		const route = scenarioFor('Построй маршрут на 90 минут');

		const routeDefault = categoriesFor(route, { purpose: 'route' });

		expect(routeDefault).toEqual(expect.arrayContaining(['monument', 'park', 'museum']));
		expect(routeDefault).not.toContain('fast_food');
		expect(routeDefault).not.toContain('cafe');
		// The model may narrow a route the user left open...
		expect(categoriesFor(route, { purpose: 'route', requested: ['museum'] })).toEqual(['museum']);
		// ...but not replace an interest the user stated.
		const walk = categoriesFor(scenarioFor('Хочу прогуляться'), { purpose: 'search', requested: ['fast_food'] });
		expect(walk).toContain('park');
		expect(walk).not.toContain('fast_food');
		expect(categoriesFor(scenarioFor('Хочу кофе'), { purpose: 'search', requested: ['park'] })).toEqual([
			'cafe',
			'library',
		]);
		expect(categoriesFor(scenarioFor('Я у музея Нур Алем'), { purpose: 'search', requested: ['park'] })).toEqual([
			'park',
		]);
	});
});
