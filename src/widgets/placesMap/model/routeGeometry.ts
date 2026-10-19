import { type WalkingRoute } from '@server/places/model/walkingRoute.schema';

/** Each returned leg is independent: never invent connections between stops. */
export function routeGeometry(route?: WalkingRoute | null) {
	return {
		features: (route?.status === 'available' ? route.legs : []).map((leg) => ({
			geometry: {
				coordinates: leg.geometry.coordinates,
				type: 'LineString' as const,
			},
			properties: {},
			type: 'Feature' as const,
		})),
		type: 'FeatureCollection' as const,
	};
}
