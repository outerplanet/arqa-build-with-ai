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
// Weights sum to 1; the score is clamped to 0..1 after the generic-name penalty below.
const WEIGHTS = { distance: 0.25, open: 0.15, popularity: 0.1, semantic: 0.4, tags: 0.1 };
const VISIT_MINUTES: Record<Category, number> = {
	artwork: 15,
	attraction: 30,
	bar: 45,
	cafe: 30,
	cinema: 120,
	fast_food: 20,
	// A city walk passes through a park or a small gallery; 40–45 minutes each left a 90-minute
	// route from Baiterek with one stop.
	gallery: 40,
	garden: 30,
	library: 40,
	mall: 60,
	monument: 15,
	museum: 60,
	nightclub: 90,
	other: 30,
	park: 30,
	place_of_worship: 30,
	playground: 40,
	restaurant: 60,
	sports: 60,
	theatre: 120,
	theme_park: 90,
	viewpoint: 20,
	zoo: 90,
};

// Subtracted from the weighted score when a name is only a category word ("Кафе", "Сквер"):
// such a place is still real, but a named one with equal signals is the better suggestion.
const GENERIC_NAME_PENALTY = 0.05;
// Charged per already chosen place of the same category while filling the result list.
const DIVERSITY_PENALTY = 0.1;
// Compared after nameKey(): lower case, ё→е, letters and digits only.
const GENERIC_NAMES = new Set([
	'cafe',
	'coffee',
	'park',
	'restaurant',
	'аллея',
	'бар',
	'бистро',
	'бульвар',
	'детскаяплощадка',
	'кафе',
	'кофе',
	'кофейня',
	'памятник',
	'парк',
	'пекарня',
	'площадка',
	'ресторан',
	'сад',
	'сквер',
	'скульптура',
	'столовая',
	'фонтан',
]);

function unit(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Chain branches share a key: "Coffee Boom", "COFFEE  BOOM" and "coffee-boom" are one name. */
function nameKey(name: string): string {
	return name
		.toLowerCase()
		.replaceAll('ё', 'е')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

function byId(left: Candidate, right: Candidate): number {
	return left.place.id < right.place.id ? -1 : left.place.id > right.place.id ? 1 : 0;
}

/**
 * Greedy selection that charges a candidate for each already chosen place of its category, so
 * four cafes 60 m apart do not push the only park out of a five-item list. Scores are unchanged;
 * closed places still come last.
 */
function diversified(ranked: readonly Candidate[], limit: number): Candidate[] {
	const remaining = [...ranked];
	const chosen: Candidate[] = [];
	const perCategory = new Map<Category, number>();
	const value = (candidate: Candidate) =>
		candidate.score - DIVERSITY_PENALTY * (perCategory.get(candidate.place.category) ?? 0);
	while (chosen.length < limit && remaining.length > 0) {
		let best = 0;
		for (let index = 1; index < remaining.length; index += 1) {
			const left = remaining[index]!;
			const right = remaining[best]!;
			const order =
				Number(left.open.status === 'closed') - Number(right.open.status === 'closed') ||
				value(right) - value(left) ||
				byId(left, right);
			if (order < 0) best = index;
		}
		const [next] = remaining.splice(best, 1);
		chosen.push(next!);
		perCategory.set(next!.place.category, (perCategory.get(next!.place.category) ?? 0) + 1);
	}
	return chosen;
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
					WEIGHTS.tags * Number(why.tags.length > 0) -
					GENERIC_NAME_PENALTY * Number(GENERIC_NAMES.has(nameKey(place.name))),
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
	// One branch per chain: after sorting, the first occurrence of a name is its best branch.
	// Deduplicating before the limit keeps a list from filling up with twenty "Шашлычок".
	const seenNames = new Set<string>();
	const ranked = candidates
		.sort(
			(left, right) =>
				Number(left.open.status === 'closed') - Number(right.open.status === 'closed') ||
				right.score - left.score ||
				byId(left, right),
		)
		.filter((candidate) => {
			const key = nameKey(candidate.place.name) || candidate.place.id;
			if (seenNames.has(key)) return false;
			seenNames.add(key);
			return true;
		});
	return diversified(ranked, Math.floor(input.limit));
}
