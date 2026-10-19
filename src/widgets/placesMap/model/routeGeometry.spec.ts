import { describe, expect, it } from 'vitest';
import { routeGeometry } from './routeGeometry';

describe('routeGeometry', () => {
	it('uses the returned legs in longitude-latitude order without joining gaps', () => {
		const result = routeGeometry({
			collectedAt: '2026-10-19T12:00:00Z',
			distanceM: 200,
			legs: [
				{
					distanceM: 100,
					from: { lat: 51, lon: 71 },
					fromOffsetM: 5,
					geometry: {
						coordinates: [
							[71, 51],
							[71.1, 51.05],
							[71.2, 51.1],
						],
						type: 'LineString',
					},
					to: { lat: 51.1, lon: 71.2 },
					toOffsetM: 10,
					walkMinutes: 2,
				},
				{
					distanceM: 100,
					from: { lat: 51.4, lon: 71.5 },
					fromOffsetM: 10,
					geometry: {
						coordinates: [
							[71.5, 51.4],
							[71.6, 51.5],
							[71.7, 51.6],
						],
						type: 'LineString',
					},
					to: { lat: 51.6, lon: 71.7 },
					toOffsetM: 5,
					walkMinutes: 2,
				},
			],
			note: 'Входы требуют проверки.',
			source: 'OpenStreetMap',
			status: 'available',
			stopIds: ['osm:node/1', 'osm:node/2'],
			totalMinutes: 24,
			walkMinutes: 4,
		});
		expect(result.features.map((feature) => feature.geometry.coordinates)).toEqual([
			[
				[71, 51],
				[71.1, 51.05],
				[71.2, 51.1],
			],
			[
				[71.5, 51.4],
				[71.6, 51.5],
				[71.7, 51.6],
			],
		]);
	});

	it('does not create a route without a tool plan', () => {
		expect(routeGeometry().features).toEqual([]);
		expect(routeGeometry(null).features).toEqual([]);
		expect(routeGeometry({ note: 'Граф недоступен.', status: 'unavailable' }).features).toEqual([]);
	});
});
