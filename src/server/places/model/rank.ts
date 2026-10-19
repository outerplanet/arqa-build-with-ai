import 'server-only';
import { distanceM, walkMinutes } from './geo';
import { openStatus } from './hours';
import { type Candidate, type Category, type GeoPoint, type Place } from './places.schema';

export interface RankInput {
	accessibleOnly?: boolean;
	at: Date;
	categories?: readonly Category[];
	limit: number;
	maxWalkMinutes: number;
	origin: GeoPoint;
	places: readonly Place[];
	semantic: ReadonlyMap<string, number>;
}

// Relevance leads; proximity and hours come next, popularity and tags are smaller signals.
const WEIGHTS = { distance: 0.25, open: 0.15, popularity: 0.1, semantic: 0.4, tags: 0.1 };
const VISIT_MINUTES: Record<Category, number> = {
	artwork: 15,
	attraction: 30,
	bar: 45,
	cafe: 30,
	cinema: 120,
	fast_food: 20,
	gallery: 45,
	garden: 40,
	library: 40,
	mall: 60,
	monument: 15,
	museum: 60,
	nightclub: 90,
	other: 30,
	park: 40,
	place_of_worship: 30,
	playground: 40,
	restaurant: 60,
	sports: 60,
	theatre: 120,
	theme_park: 90,
	viewpoint: 20,
	zoo: 90,
};

function unit(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function rankPlaces(input: RankInput): Candidate[] {
	const candidates = input.places
		.filter(
			(place) =>
				(!input.categories?.length || input.categories.includes(place.category)) &&
				(!input.accessibleOnly || place.wheelchair === 'yes'),
		)
		.map((place) => {
			const meters = distanceM(input.origin, place);
			const minutes = walkMinutes(meters);
			const open = openStatus(place.openingHours, input.at);
			const why = {
				distance: unit(input.maxWalkMinutes > 0 ? 1 - minutes / input.maxWalkMinutes : minutes === 0 ? 1 : 0),
				open: open.status === 'open' ? 1 : open.status === 'unknown' ? 0.5 : 0,
				popularity: unit(place.popularity ?? 0),
				semantic: unit(input.semantic.get(place.id) ?? 0),
				// RankInput has no requested tags or query. Do not invent tag matches.
				tags: [] as string[],
			};
			const score = unit(
				WEIGHTS.semantic * why.semantic +
					WEIGHTS.distance * why.distance +
					WEIGHTS.open * why.open +
					WEIGHTS.popularity * why.popularity +
					WEIGHTS.tags * 0,
			);
			return {
				distanceM: meters,
				open,
				place,
				score,
				visitMinutes: VISIT_MINUTES[place.category],
				walkMinutes: minutes,
				why,
			};
		})
		.filter((candidate) => candidate.walkMinutes <= input.maxWalkMinutes);
	return candidates
		.sort(
			(left, right) =>
				Number(left.open.status === 'closed') - Number(right.open.status === 'closed') ||
				right.score - left.score ||
				(left.place.id < right.place.id ? -1 : left.place.id > right.place.id ? 1 : 0),
		)
		.slice(0, Math.max(0, input.limit));
}
