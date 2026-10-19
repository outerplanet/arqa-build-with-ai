import { DomainError } from '@server/kernel/errors';
import { distanceM } from '@server/places/model/geo';
import {
	type Place,
	type ResolvedLocation,
	resolvedLocationSchema,
	resolveLocationInputSchema,
} from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import {
	BAYTEREK_ALIASES,
	EXPO_ALIASES,
	LANDMARKS,
	MEGA_ALIASES,
	mentions,
	normalizeLocation,
	NUR_ALEM_ALIASES,
} from './landmarks';
import { roundLocation } from './origin';

function named(place: Place, aliases: readonly string[]): boolean {
	return [place.name, place.nameEn ?? ''].some((name) =>
		aliases.some((alias) => normalizeLocation(name) === normalizeLocation(alias)),
	);
}

function coalesceVerifiedMall(matches: readonly Place[]): readonly Place[] {
	const outline = matches.find((place) => place.id === 'osm:way/499328514');
	const node = matches.find((place) => place.id === 'osm:node/4965336822');
	// Verified 2026-10-19 via OSM /api/0.6/way/499328514/full.json and
	// /api/0.6/node/4965336822.json: the named mall node is inside its named mall outline.
	// This is an identity exception, never a general "nearest same-name wins" rule.
	if (
		outline &&
		node &&
		outline.category === 'mall' &&
		node.category === 'mall' &&
		named(outline, MEGA_ALIASES) &&
		named(node, MEGA_ALIASES) &&
		distanceM(outline, node) <= 30
	) {
		return matches.filter((place) => place !== node);
	}
	return matches;
}

export function resolveLocation(
	ctx: PlacesContext,
	input: z.input<typeof resolveLocationInputSchema>,
): ResolvedLocation {
	const { text } = resolveLocationInputSchema.parse(input);
	if (ctx.userMessages !== undefined && !ctx.userMessages.some((message) => mentions(message, text))) {
		throw new DomainError('validation', { constraint: 'location_unconfirmed' });
	}
	const explicitMuseum = NUR_ALEM_ALIASES.some((alias) => mentions(text, alias));
	const groups = LANDMARKS.filter(
		(aliases) => aliases.some((alias) => mentions(text, alias)) && !(explicitMuseum && aliases === EXPO_ALIASES),
	);
	// EXPO can mean its landmark museum, but the specific museum never means the broad EXPO area.
	if (!explicitMuseum && groups.includes(EXPO_ALIASES)) groups.push(NUR_ALEM_ALIASES);
	const matches = coalesceVerifiedMall(
		dependencies(ctx)
			.readPlaces()
			.filter((place) => {
				if (groups.length > 0) {
					return groups.some(
						(aliases) => named(place, aliases) && (aliases !== BAYTEREK_ALIASES || place.category === 'monument'),
					);
				}
				return [place.name, place.nameEn ?? ''].filter(Boolean).some((name) => mentions(text, name));
			}),
	);
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
