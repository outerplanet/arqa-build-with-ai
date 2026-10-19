import { scenarioFor } from '@server/agent/usecase/scenario';
import { describe, expect, it } from 'vitest';

describe('scenarioFor', () => {
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
});
