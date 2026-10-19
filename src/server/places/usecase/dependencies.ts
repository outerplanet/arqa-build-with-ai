import { DomainError } from '@server/kernel/errors';
import { lexicalScores } from '@server/places/model/lexical';
import { type Candidate, type GeoPoint, type Place, type WalkPlan } from '@server/places/model/places.schema';
import { type RankInput, rankPlaces } from '@server/places/model/rank';
import { planWalk } from '@server/places/model/route';
import 'server-only';

export type { RankInput };

export interface PlaceVectors {
	byId: Map<string, Float32Array>;
	dims: number;
	model: string;
}

/** Algorithms are live; only the data repo lane remains pending. */
export interface PlacesDependencies {
	getPlaceById: (id: string) => Place | null;
	lexicalScores: (query: string, places: readonly Place[]) => Map<string, number>;
	planWalk: (input: {
		candidates: readonly Candidate[];
		durationMinutes: number;
		maxStops: number;
		start: GeoPoint;
	}) => WalkPlan;
	rankPlaces: (input: RankInput) => Candidate[];
	readPlaces: () => readonly Place[];
	readVectors: () => PlaceVectors | null;
}

function unavailable(): never {
	throw new DomainError('conflict', { constraint: 'places_unavailable' });
}

/** No sample or invented POIs: pending dependencies fail visibly until the team connects them. */
export const placesDependencies: PlacesDependencies = {
	getPlaceById: unavailable,
	lexicalScores,
	planWalk,
	rankPlaces,
	readPlaces: unavailable,
	readVectors: () => null,
};
