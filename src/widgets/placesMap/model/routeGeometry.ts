import { type WalkPlan } from '@server/places/model/places.schema';

/** Each returned leg is independent: never invent connections between stops. */
export function routeGeometry(plan?: WalkPlan | null) {
	return {
		features: (plan?.legs ?? []).map((leg) => ({
			geometry: {
				coordinates: [
					[leg.from.lon, leg.from.lat],
					[leg.to.lon, leg.to.lat],
				],
				type: 'LineString' as const,
			},
			properties: {},
			type: 'Feature' as const,
		})),
		type: 'FeatureCollection' as const,
	};
}
