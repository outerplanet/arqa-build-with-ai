import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { z } from 'zod';
import { type Place, placeSchema } from '../model/places.schema';

let cached: readonly Place[] | undefined;

/** Read only committed public POIs. No request or user location enters this cache. */
export function readPlaces(): readonly Place[] {
	if (cached !== undefined) return cached;
	const fullPath = resolve('data/poi.json');
	const path = existsSync(fullPath) ? fullPath : resolve('data/poi.sample.json');
	const places = z
		.array(placeSchema)
		.min(1)
		.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
	if (new Set(places.map((place) => place.id)).size !== places.length) throw new Error('Duplicate POI ids');
	cached = Object.freeze(places);
	return cached;
}

export function getPlaceById(id: string): Place | null {
	return readPlaces().find((place) => place.id === id) ?? null;
}
