import {
	findPlacesInputSchema,
	type FindPlacesResult,
	findPlacesResultSchema,
	placeSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { assertOrigin, origin } from './origin';
import { semanticScores } from './semantic';

export async function findPlaces(
	ctx: PlacesContext,
	input: z.input<typeof findPlacesInputSchema>,
): Promise<FindPlacesResult> {
	const parsed = findPlacesInputSchema.parse(input);
	const location = origin(ctx);

	if (parsed.near !== undefined) assertOrigin(ctx, parsed.near);
	const places = z.array(placeSchema).parse(dependencies(ctx).readPlaces());
	const semantic = await semanticScores(ctx, { places, query: parsed.query });
	const at = parsed.at === undefined ? ctx.now : z.coerce.date().parse(parsed.at);
	const candidates = dependencies(ctx).rankPlaces({
		accessibleOnly: parsed.accessibleOnly,
		at,
		categories: parsed.categories,
		limit: parsed.limit,
		maxWalkMinutes: parsed.maxWalkMinutes,
		origin: location.point,
		places,
		semantic: semantic.scores,
	});

	return findPlacesResultSchema.parse({
		candidates,
		note: semantic.note,
		origin: location,
		usedFilters: [
			`Запрос: ${parsed.query}`,
			`Пешком до ${parsed.maxWalkMinutes} минут`,
			`Время проверки: ${at.toISOString()}`,
			...(parsed.categories === undefined ? [] : [`Категории: ${parsed.categories.join(', ')}`]),
			...(parsed.accessibleOnly === true ? ['Только места с подтверждённой доступностью для колясок'] : []),
		],
	});
}
