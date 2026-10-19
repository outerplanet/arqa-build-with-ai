import 'server-only';
import { describe, expect, it } from 'vitest';
import { distanceM, roundPoint, walkMinutes } from './geo';

describe('walking geography', () => {
	it('returns zero for identical points', () => {
		expect(distanceM({ lat: 51.128, lon: 71.43 }, { lat: 51.128, lon: 71.43 })).toBe(0);
	});
	it('measures a degree at the equator and is symmetric', () => {
		const a = { lat: 0, lon: 0 };
		const b = { lat: 0, lon: 1 };
		expect(distanceM(a, b)).toBeCloseTo(111_195, -1);
		expect(distanceM(a, b)).toBe(distanceM(b, a));
	});
	it('keeps antipodal distances finite and crosses the date line', () => {
		expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20_015_114, -1);
		expect(distanceM({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 })).toBeLessThan(223);
	});
	it('inflates walking distance and rounds minutes up', () => {
		expect(walkMinutes(0)).toBe(0);
		expect(walkMinutes(750)).toBe(13);
		expect(walkMinutes(1)).toBe(1);
	});
	it('rounds coordinates without mutating the original', () => {
		const point = { lat: 51.123456, lon: 71.987654 };
		expect(roundPoint(point)).toEqual({ lat: 51.123, lon: 71.988 });
		expect(roundPoint(point, 2)).toEqual({ lat: 51.12, lon: 71.99 });
		expect(point.lat).toBe(51.123456);
	});
});
