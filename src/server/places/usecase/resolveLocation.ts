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
	const unresolved: ResolvedLocation = {
		confidence: 'low',
		found: false,
		label: null,
		matchedPlaceId: null,
		point: null,
	};
	// Even a group without a canonical ID is a second location, not permission to pick the first.
	if (groups.length > 1) return unresolved;
	const places = dependencies(ctx).readPlaces();
	const explicit = places.filter((place) =>
		[place.name, place.nameEn ?? ''].some(
			(name) =>
				name &&
				mentions(text, name) &&
				groups.some((aliases) => aliases.some((alias) => mentions(name, alias))) &&
				!groups.some((aliases) => aliases.some((alias) => normalizeLocation(alias) === normalizeLocation(name))),
		),
	);
	// A short alias embedded in a full POI name must not replace that explicitly named object.
	const explicitContainsAlias =
		explicit.length === 1 &&
		groups.some((aliases) =>
			aliases.some((alias) => mentions(explicit[0]!.name, alias) || mentions(explicit[0]!.nameEn ?? '', alias)),
		);
	if (groups.length && explicit.length && !explicitContainsAlias) return unresolved;
	if (groups.length) {
		// Mask whole mentions before looking for another POI. A cafe named "Нур" inside
		// "Нур Алем" is not a second location; the same cafe named separately still is.
		const protectedNames = [
			...groups.flat(),
			...(explicitContainsAlias ? [explicit[0]!.name, explicit[0]!.nameEn ?? ''] : []),
		]
			.map(normalizeLocation)
			.filter(Boolean)
			.sort((left, right) => right.length - left.length);
		const remaining = protectedNames.reduce(
			(value, name) => value.replace(new RegExp(`(?<= )${name}(?= )`, 'gu'), ' '.repeat(name.length)),
			` ${normalizeLocation(text)} `,
		);
		if (places.some((place) => [place.name, place.nameEn ?? ''].some((name) => name && mentions(remaining, name)))) {
			return unresolved;
		}
	}
	const anchorIds = groups.map((group) => LANDMARK_IDS.get(group)).filter((id) => id !== undefined);
	if (groups.includes(LANDMARKS[0]!) && /квартал|территори/iu.test(text)) {
		anchorIds.splice(anchorIds.indexOf('osm:way/454853233'), 1, 'osm:way/1456208623');
	}
	// The monument and shopping-centre anchors cannot stand in for a requested rail station.
	if (anchorIds.length && /станци|вокзал/iu.test(text) && !explicitContainsAlias) return unresolved;
	const anchored = places.filter((place) => anchorIds.includes(place.id));
	const matches = explicitContainsAlias
		? explicit
		: anchorIds.length
			? anchorIds.length === 1
				? anchored
				: []
			: places.filter((place) => {
					const names = [place.name, place.nameEn ?? ''].filter(Boolean);

					return (
						names.some((name) => mentions(text, name)) ||
						groups.some((aliases) =>
							names.some((name) =>
								aliases.some((alias) => normalizeLocation(name) === normalizeLocation(alias)),
							),
						)
					);
				});
	// Ambiguity is a question, not an arbitrary choice of one branch or one campus.
	if (matches.length !== 1) {
		return unresolved;
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
