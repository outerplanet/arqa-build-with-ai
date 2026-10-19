import {
	type ResolvedLocation,
	resolvedLocationSchema,
	resolveLocationInputSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { LANDMARKS, mentions, normalizeLocation } from './landmarks';
import { roundLocation } from './origin';

export function resolveLocation(
	ctx: PlacesContext,
	input: z.input<typeof resolveLocationInputSchema>,
): ResolvedLocation {
	const { text } = resolveLocationInputSchema.parse(input);
	const groups = LANDMARKS.filter((aliases) => aliases.some((alias) => mentions(text, alias)));
	const matches = dependencies(ctx)
		.readPlaces()
		.filter((place) => {
			const names = [place.name, place.nameEn ?? ''].filter(Boolean);

			return (
				names.some((name) => mentions(text, name)) ||
				groups.some((aliases) =>
					names.some((name) => aliases.some((alias) => normalizeLocation(name) === normalizeLocation(alias))),
				)
			);
		});
	// Ambiguity is a question, not an arbitrary choice of one branch or one campus.
	if (matches.length !== 1) {
		return { confidence: 'low', found: false, label: null, matchedPlaceId: null, point: null };
	}
	const [place] = matches;

	return resolvedLocationSchema.parse({
		confidence: 'high',
		found: true,
		label: place!.name,
		matchedPlaceId: place!.id,
		point: roundLocation(place!),
	});
}
