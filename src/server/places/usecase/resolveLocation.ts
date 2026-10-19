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
	ALEM_AI_ALIASES,
	BAYTEREK_ALIASES,
	EXPO_ALIASES,
	LANDMARKS,
	MEGA_ALIASES,
	mentions,
	mentionsExact,
	namePattern,
	normalizeLocation,
	NUR_ALEM_ALIASES,
} from './landmarks';
import { roundLocation } from './origin';

/** EXPO, its sphere, Nur Alem and Alem.ai are one verified anchor: the former Nur Alem building. */
const EXPO_AREA: readonly (readonly string[])[] = [EXPO_ALIASES, NUR_ALEM_ALIASES, ALEM_AI_ALIASES];
const EXPO_AREA_LABEL = 'Alem.ai (бывший Нур Алем), территория ЭКСПО';

const UNRESOLVED: ResolvedLocation = {
	confidence: 'low',
	found: false,
	label: null,
	matchedPlaceId: null,
	point: null,
};

function named(place: Place, aliases: readonly string[]): boolean {
	return [place.name, place.nameEn ?? ''].some((name) =>
		aliases.some((alias) => normalizeLocation(name) === normalizeLocation(alias)),
	);
}

function historicalMuseum(place: Place): boolean {
	// data/nur-alem-history.json preserves OSM way 454857501 versions 11–12:
	// name:ru="Музей Нур Алем". Version 15 names the SAME object Alem.ai.
	// The EXPO sphere is that building; the separate EXPO site and quarter outlines are areas
	// whose centroids are not where a visitor "at EXPO" stands, so they are never the anchor.
	return (
		place.id === 'osm:way/454857501' &&
		place.sourceUrl === 'https://www.openstreetmap.org/way/454857501' &&
		place.category === 'museum' &&
		named(place, ALEM_AI_ALIASES)
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

function landmarkMatches(places: readonly Place[], aliases: readonly string[]): readonly Place[] {
	if (EXPO_AREA.includes(aliases)) return places.filter(historicalMuseum);
	return coalesceVerifiedMall(
		places.filter(
			(place) => named(place, aliases) && (aliases !== BAYTEREK_ALIASES || place.category === 'monument'),
		),
	);
}

/** Another named dataset POI beside the landmark ("между Нур Алем и Национальным музеем") is a question. */
function mentionsAnotherPlace(
	text: string,
	{ aliases, anchor, places }: { aliases: readonly string[]; anchor: Place; places: readonly Place[] },
): boolean {
	const remaining = [...aliases]
		.sort((left, right) => right.length - left.length)
		.reduce((value, alias) => value.replace(namePattern(alias, 'gu'), ' '), ` ${normalizeLocation(text)} `);
	// Multiword names only: single-word venues ("Нур", "Мост", "Вечер") are ordinary words too.
	return places.some(
		(place) =>
			place.id !== anchor.id &&
			[place.name, place.nameEn ?? ''].some(
				(name) => normalizeLocation(name).includes(' ') && mentionsExact(remaining, name),
			),
	);
}

export function resolveLocation(
	ctx: PlacesContext,
	input: z.input<typeof resolveLocationInputSchema>,
): ResolvedLocation {
	const { text } = resolveLocationInputSchema.parse(input);
	if (ctx.userMessages !== undefined && !ctx.userMessages.some((message) => mentions(message, text))) {
		throw new DomainError('validation', { constraint: 'location_unconfirmed' });
	}
	const places = dependencies(ctx).readPlaces();
	const groups = LANDMARKS.filter((aliases) => aliases.some((alias) => mentions(text, alias)));
	let place: Place | undefined;

	if (groups.length === 0) {
		const matches = places.filter((item) =>
			[item.name, item.nameEn ?? ''].filter(Boolean).some((name) => mentionsExact(text, name)),
		);
		// Ambiguity is a question, not an arbitrary choice of one branch or one campus.
		if (matches.length !== 1) return UNRESOLVED;
		[place] = matches;
	} else {
		// A station or stop named after a landmark is a different place from the landmark.
		if (/(?:^| )(?:станци|остановк)/u.test(normalizeLocation(text))) return UNRESOLVED;
		const perGroup = groups.map((aliases) => landmarkMatches(places, aliases));
		const ids = new Set(perGroup.flat().map((item) => item.id));
		// Every named landmark must be the same single verified object, or we ask.
		if (perGroup.some((matches) => matches.length !== 1) || ids.size !== 1) return UNRESOLVED;
		place = perGroup[0]![0]!;
		if (mentionsAnotherPlace(text, { aliases: groups.flat(), anchor: place, places })) return UNRESOLVED;
	}

	return resolvedLocationSchema.parse({
		confidence: 'high',
		found: true,
		label: groups.some((aliases) => EXPO_AREA.includes(aliases)) ? EXPO_AREA_LABEL : place!.name,
		matchedPlaceId: place!.id,
		point: roundLocation(place!),
	});
}
