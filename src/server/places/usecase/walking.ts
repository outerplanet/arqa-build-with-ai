import { type GeoPoint, type WalkPlan } from '@server/places/model/places.schema';
import {
	createWalkingGraph,
	createWalkingSession,
	type findWalkingPath,
	type WalkingGraphIndex,
} from '@server/places/model/walkingGraph';
import { type WalkingRoute, walkingRouteSchema } from '@server/places/model/walkingRoute.schema';
import 'server-only';
import { dependencies, type PlacesContext } from './context';

// Only the public, static OSM graph is retained. Snap locations stay inside one request.
const indexes = new WeakMap<object, WalkingGraphIndex>();

export function walkingCalculator(ctx: PlacesContext) {
	try {
		const data = dependencies(ctx).readWalkingGraph?.();
		if (!data) return null;
		let graph = indexes.get(data);
		if (!graph) {
			graph = createWalkingGraph(data);
			indexes.set(data, graph);
		}
		const index = graph;
		const findPath = createWalkingSession(index);
		const paths = new Map<string, ReturnType<typeof findWalkingPath>>();
		const pathFor = (from: GeoPoint, to: GeoPoint) => {
			const key = JSON.stringify([from.lat, from.lon, to.lat, to.lon]);
			if (!paths.has(key)) paths.set(key, findPath({ from, maxSnapM: 75, to }));
			return paths.get(key) ?? null;
		};
		return {
			measureLeg: (from: GeoPoint, to: GeoPoint) => {
				const path = pathFor(from, to);
				// Graph distances already follow streets: no additional 1.3 detour multiplier.
				return path ? { distanceM: path.distanceM, walkMinutes: Math.ceil(path.distanceM / 75) } : null;
			},
			routeFor: (plan: WalkPlan): WalkingRoute => {
				if (plan.stops.length === 0)
					return {
						note: 'Связный пешеходный путь в указанном бюджете не найден. Прямую линию не показываем.',
						status: 'unavailable',
					};
				const legs = plan.legs.map((leg) => {
					const path = pathFor(leg.from, leg.to);
					if (
						!path ||
						Math.abs(path.distanceM - leg.distanceM) > 0.01 ||
						Math.ceil(path.distanceM / 75) !== leg.walkMinutes
					)
						throw new Error('Inconsistent walking plan');
					return {
						distanceM: path.distanceM,
						from: path.fromSnap.point,
						fromOffsetM: path.fromSnap.offsetM,
						geometry: { coordinates: path.coordinates, type: 'LineString' as const },
						to: path.toSnap.point,
						toOffsetM: path.toSnap.offsetM,
						walkMinutes: leg.walkMinutes,
					};
				});
				return walkingRouteSchema.parse({
					collectedAt: data.collectedAt,
					distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
					legs,
					// Shown once in the reply and under the map: short, and it keeps the three real caveats.
					note: 'Путь по пешеходным дорожкам OpenStreetMap; входы, лестницы и временные перекрытия не проверены.',
					source: 'OpenStreetMap',
					status: 'available',
					stopIds: plan.stops.map((stop) => stop.candidate.place.id),
					totalMinutes: plan.totalMinutes,
					walkMinutes: legs.reduce((sum, leg) => sum + leg.walkMinutes, 0),
				});
			},
		};
	} catch {
		return null;
	}
}
