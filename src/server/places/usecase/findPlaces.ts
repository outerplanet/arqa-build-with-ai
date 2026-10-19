import { DomainError } from '@server/kernel/errors';
import { distanceM } from '@server/places/model/geo';
import {
	findPlacesInputSchema,
	type FindPlacesResult,
	findPlacesResultSchema,
	type Place,
	placeSchema,
	planWalkInputSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { z } from 'zod';
import { categoryNames } from './categoryNames';
import { dependencies, type PlacesContext } from './context';
import { normalizeLocation } from './landmarks';
import { assertOrigin, origin } from './origin';
import { semanticScores } from './semantic';

const SAME_PLACE_M = 50;
const ASTANA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The user is already at the landmark they named: it, and its same-name duplicates, are not suggestions. */
function withoutStartingPoint(ctx: PlacesContext, places: readonly Place[]): Place[] {
	const id = ctx.browserLocation === undefined ? ctx.resolvedLocation?.matchedPlaceId : null;
	if (!id) return [...places];
	const anchor = places.find((place) => place.id === id);
	const names = new Set(
		[anchor?.name, anchor?.nameEn].filter((name): name is string => Boolean(name)).map(normalizeLocation),
	);
	return places.filter(
		(place) =>
			place.id !== id &&
			!(
				anchor &&
				distanceM(anchor, place) <= SAME_PLACE_M &&
				[place.name, place.nameEn ?? ''].some((name) => names.has(normalizeLocation(name)))
			),
	);
}

/** Astana has been UTC+5 all year since 2024-03-01; no DST. */
function astanaTime(at: Date): string {
	const local = new Date(at.getTime() + ASTANA_OFFSET_MS);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} по Астане`;
}

// «До 10 минут пешком», «не больше 15 мин ходьбы»: a limit the user named is never stretched.
const STATED_WALK_LIMIT = /(?:до|в пределах|не больше|не более)\s*\d{1,2}\s*мин[а-я]*\s*(?:пешком|ходьбы)/iu;
// With an hour or more, a sightseer may walk a little further to a place the data vouches for
// (Wikidata, a photo, popularity): half again the radius, never more than a third of the budget.
const NOTABLE_REACH_MIN_BUDGET = 60;
const NOTABLE_REACH_FACTOR = 1.5;
const NOTABLE_REACH_BUDGET_SHARE = 1 / 3;

function notableReach(
	ctx: PlacesContext,
	input: { budget: number | undefined; maxWalkMinutes: number; preferNotable: boolean },
): number | undefined {
	if (!input.preferNotable || input.budget === undefined || input.budget < NOTABLE_REACH_MIN_BUDGET) return undefined;
	if (ctx.userMessages?.some((message) => STATED_WALK_LIMIT.test(message))) return undefined;
	const reach = Math.min(
		Math.round(input.maxWalkMinutes * NOTABLE_REACH_FACTOR),
		Math.floor(input.budget * NOTABLE_REACH_BUDGET_SHARE),
	);
	return reach > input.maxWalkMinutes ? reach : undefined;
}

/** A walk's validated budget must filter the whole dataset before ranking's result limit. */
export async function searchPlaces(
	ctx: PlacesContext,
	input: {
		/** The user's whole-walk budget, quoted in the filters only; it filters nothing here. */
		budgetMinutes?: number | undefined;
		durationMinutes?: number;
		filters: z.input<typeof findPlacesInputSchema>;
		preferNotable?: boolean | undefined;
	},
): Promise<FindPlacesResult> {
	const parsed = findPlacesInputSchema.parse(input.filters);
	const durationMinutes = planWalkInputSchema.shape.durationMinutes.optional().parse(input.durationMinutes);
	const location = origin(ctx);

	if (parsed.near !== undefined) assertOrigin(ctx, parsed.near);
	const places = withoutStartingPoint(ctx, z.array(placeSchema).parse(dependencies(ctx).readPlaces()));
	const semantic = await semanticScores(ctx, { places, query: parsed.query });
	const at = parsed.at === undefined ? ctx.now : z.coerce.date().parse(parsed.at);
	const budget = input.budgetMinutes ?? durationMinutes;
	const reach = notableReach(ctx, {
		budget,
		maxWalkMinutes: parsed.maxWalkMinutes,
		preferNotable: input.preferNotable === true,
	});
	const candidates = dependencies(ctx).rankPlaces({
		accessibleOnly: parsed.accessibleOnly,
		at,
		categories: parsed.categories,
		durationMinutes,
		limit: parsed.limit,
		maxWalkMinutes: parsed.maxWalkMinutes,
		...(reach === undefined ? {} : { notableReachMinutes: reach }),
		origin: location.point,
		places,
		...(input.preferNotable ? { preferNotable: true } : {}),
		query: parsed.query,
		semantic: semantic.scores,
	});

	const result = findPlacesResultSchema.parse({
		candidates,
		note: semantic.note,
		origin: location,
		usedFilters: [
			// Two different limits, named so that nobody reads one as the other.
			`До ${parsed.maxWalkMinutes} мин пешком до каждого места`,
			...(reach === undefined
				? []
				: [`До ${reach} мин пешком — для мест с описанием в Wikidata, фото или оценкой популярности`]),
			...(budget === undefined ? [] : [`Вся прогулка — до ${budget} мин`]),
			`Время проверки: ${astanaTime(at)}`,
			...(parsed.categories === undefined
				? []
				: [`Категории: ${parsed.categories.map((category) => categoryNames[category]).join(', ')}`]),
			...(parsed.accessibleOnly === true ? ['Только места с подтверждённой доступностью для колясок'] : []),
		],
	});
	const originals = new Map(places.map((place) => [place.id, JSON.stringify(place)]));
	const ids = result.candidates.map((candidate) => candidate.place.id);

	if (
		result.candidates.length > parsed.limit ||
		new Set(ids).size !== ids.length ||
		result.candidates.some((candidate) => originals.get(candidate.place.id) !== JSON.stringify(candidate.place))
	) {
		throw new DomainError('validation', { constraint: 'invalid_place_results' });
	}
	return result;
}

export async function findPlaces(
	ctx: PlacesContext,
	input: z.input<typeof findPlacesInputSchema>,
): Promise<FindPlacesResult> {
	return searchPlaces(ctx, { filters: input });
}
