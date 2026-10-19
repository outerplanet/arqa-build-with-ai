import { lexicalScores } from '@server/places/model/lexical';
import { type Candidate, type GeoPoint, type Place, type WalkPlan } from '@server/places/model/places.schema';
import { type RankInput, rankPlaces } from '@server/places/model/rank';
import { planWalk } from '@server/places/model/route';
import { getPlaceById, readPlaces } from '@server/places/repo/places';
import { readVectors } from '@server/places/repo/vectors';
import 'server-only';

export type { RankInput };

export interface PlaceVectors {
	byId: Map<string, Float32Array>;
	dims: number;
	model: string;
}

/** Shared boundary for the real repositories and algorithms, replaceable in isolated tests. */
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

/** All default tools use the team's validated dataset; vectors remain optional. */
export const placesDependencies: PlacesDependencies = {
	getPlaceById,
	lexicalScores,
	planWalk,
	rankPlaces,
	readPlaces,
	readVectors,
};
