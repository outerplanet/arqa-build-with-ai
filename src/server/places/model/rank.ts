import 'server-only';
import { distanceM, walkMinutes } from './geo';
import { openStatus } from './hours';
import { matchingTags } from './lexical';
import { type Candidate, type Category, type GeoPoint, geoPointSchema, type Place } from './places.schema';

export interface RankInput {
	accessibleOnly?: boolean;
	at: Date;
	categories?: readonly Category[];
	durationMinutes?: number;
	limit: number;
	maxWalkMinutes: number;
	origin: GeoPoint;
	places: readonly Place[];
	query?: string;
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
	if (
		!geoPointSchema.safeParse(input.origin).success ||
		!Number.isFinite(input.at.getTime()) ||
		!Number.isFinite(input.limit) ||
		input.limit <= 0 ||
		!Number.isFinite(input.maxWalkMinutes) ||
		input.maxWalkMinutes < 0 ||
		(input.durationMinutes !== undefined && (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0))
	)
		return [];
	// Astana is UTC+5. Night requests must have positive evidence of opening.
	const hour = (((Math.floor(input.at.getTime() / 3_600_000) + 5) % 24) + 24) % 24;
	const night = hour >= 22 || hour < 6;
	const candidates = input.places
		.filter(
			(place) =>
				geoPointSchema.safeParse(place).success &&
				(!input.categories?.length || input.categories.includes(place.category)) &&
				(!input.accessibleOnly || place.wheelchair === 'yes'),
		)
		.map((place) => {
			const meters = distanceM(input.origin, place);
			const minutes = walkMinutes(meters);
			const open = openStatus(place.openingHours, input.at);
			const semantic = unit(input.semantic.get(place.id) ?? 0);
			const why = {
				distance: unit(input.maxWalkMinutes > 0 ? 1 - minutes / input.maxWalkMinutes : minutes === 0 ? 1 : 0),
				open: open.status === 'open' ? 1 : open.status === 'unknown' ? 0.5 : 0,
				popularity: unit(place.popularity ?? 0),
				// The usecase supplies retrieval relevance, including its lexical fallback.
				semantic,
				tags: input.query === undefined ? [] : matchingTags(input.query, place.tags),
			};
			const score = unit(
				WEIGHTS.semantic * why.semantic +
					WEIGHTS.distance * why.distance +
					WEIGHTS.open * why.open +
					WEIGHTS.popularity * why.popularity +
					WEIGHTS.tags * Number(why.tags.length > 0),
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
		.filter(
			(candidate) =>
				candidate.walkMinutes <= input.maxWalkMinutes &&
				(input.durationMinutes === undefined ||
					candidate.walkMinutes + candidate.visitMinutes <= input.durationMinutes) &&
				(!night || candidate.open.status === 'open'),
		);
	return candidates
		.sort(
			(left, right) =>
				Number(left.open.status === 'closed') - Number(right.open.status === 'closed') ||
				right.score - left.score ||
				(left.place.id < right.place.id ? -1 : left.place.id > right.place.id ? 1 : 0),
		)
		.slice(0, Math.floor(input.limit));
}
