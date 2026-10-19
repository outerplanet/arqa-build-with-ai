import { describe, expect, it } from 'vitest';
import { routeGeometry } from './routeGeometry';

describe('routeGeometry', () => {
	it('uses the returned legs in longitude-latitude order without joining gaps', () => {
		const result = routeGeometry({
			legs: [
				{ distanceM: 100, from: { lat: 51, lon: 71 }, to: { lat: 51.1, lon: 71.2 }, walkMinutes: 2 },
				{ distanceM: 100, from: { lat: 51.4, lon: 71.5 }, to: { lat: 51.6, lon: 71.7 }, walkMinutes: 2 },
			],
			note: 'Прямые отрезки',
			stops: [],
			totalMinutes: 4,
		});
		expect(result.features.map((feature) => feature.geometry.coordinates)).toEqual([
			[
				[71, 51],
				[71.2, 51.1],
			],
			[
				[71.5, 51.4],
				[71.7, 51.6],
			],
		]);
	});

	it('does not create a route without a tool plan', () => {
		expect(routeGeometry().features).toEqual([]);
	});
});
