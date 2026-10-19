import { DomainError } from '@server/kernel/errors';
import {
	findPlacesInputSchema,
	type FindPlacesResult,
	findPlacesResultSchema,
	placeSchema,
	planWalkInputSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { z } from 'zod';
import { categoryNames } from './categoryNames';
import { dependencies, type PlacesContext } from './context';
import { assertOrigin, origin } from './origin';
import { semanticScores } from './semantic';

/** A walk's validated budget must filter the whole dataset before ranking's result limit. */
export async function searchPlaces(
	ctx: PlacesContext,
	input: { durationMinutes?: number; filters: z.input<typeof findPlacesInputSchema> },
): Promise<FindPlacesResult> {
	const parsed = findPlacesInputSchema.parse(input.filters);
	const durationMinutes = planWalkInputSchema.shape.durationMinutes.optional().parse(input.durationMinutes);
	const location = origin(ctx);

	if (parsed.near !== undefined) assertOrigin(ctx, parsed.near);
	const places = z.array(placeSchema).parse(dependencies(ctx).readPlaces());
	const semantic = await semanticScores(ctx, { places, query: parsed.query });
	const at = parsed.at === undefined ? ctx.now : z.coerce.date().parse(parsed.at);
	const candidates = dependencies(ctx).rankPlaces({
		accessibleOnly: parsed.accessibleOnly,
		at,
		categories: parsed.categories,
		durationMinutes,
		limit: parsed.limit,
		maxWalkMinutes: parsed.maxWalkMinutes,
		origin: location.point,
		places,
		query: parsed.query,
		semantic: semantic.scores,
	});

	const result = findPlacesResultSchema.parse({
		candidates,
		note: semantic.note,
		origin: location,
		usedFilters: [
			`Запрос: ${parsed.query}`,
			`Пешком до ${parsed.maxWalkMinutes} минут`,
			`Время проверки: ${at.toISOString()}`,
			...(durationMinutes === undefined ? [] : [`Ходьба и посещение до ${durationMinutes} минут`]),
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
