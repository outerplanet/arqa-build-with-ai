import 'server-only';

// Structural input until the lead publishes GeoPoint; no runtime schema is duplicated here.
interface Coordinates {
	lat: number;
	lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

export function distanceM(a: Coordinates, b: Coordinates): number {
	const halfLat = radians(b.lat - a.lat) / 2;
	const halfLon = radians(b.lon - a.lon) / 2;
	const haversine =
		Math.sin(halfLat) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(halfLon) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

export function walkMinutes(meters: number): number {
	// Straight-line distance is inflated for street detours; walking speed is 75 m/min.
	return Math.ceil((Math.max(0, meters) * 1.3) / 75);
}

export function roundPoint(point: Coordinates, decimals = 3): Coordinates {
	const factor = 10 ** decimals;
	return { lat: Math.round(point.lat * factor) / factor, lon: Math.round(point.lon * factor) / factor };
}
