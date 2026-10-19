import { DomainError } from '@server/kernel/errors';
import {
	type ResolvedLocation,
	resolvedLocationSchema,
	resolveLocationInputSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { LANDMARK_IDS, LANDMARKS, mentions, normalizeLocation } from './landmarks';
import { roundLocation } from './origin';

export function resolveLocation(
	ctx: PlacesContext,
	input: z.input<typeof resolveLocationInputSchema>,
): ResolvedLocation {
	const { text } = resolveLocationInputSchema.parse(input);
	if (ctx.userMessages !== undefined && !ctx.userMessages.some((message) => mentions(message, text))) {
		throw new DomainError('validation', { constraint: 'location_unconfirmed' });
	}
	const groups = LANDMARKS.filter((aliases) => aliases.some((alias) => mentions(text, alias)));
	const places = dependencies(ctx).readPlaces();
	const anchorIds = groups.map((group) => LANDMARK_IDS.get(group)).filter((id) => id !== undefined);
	if (groups.includes(LANDMARKS[0]!) && /квартал|территори/iu.test(text)) {
		anchorIds.splice(anchorIds.indexOf('osm:way/454853233'), 1, 'osm:way/1456208623');
	}
	const anchored = places.filter((place) => anchorIds.includes(place.id));
	const matches = anchorIds.length
		? anchorIds.length === 1
			? anchored
			: []
		: places.filter((place) => {
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
