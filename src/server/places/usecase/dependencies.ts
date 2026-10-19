import { lexicalScores } from '@server/places/model/lexical';
import {
	type Candidate,
	type Category,
	type GeoPoint,
	type Place,
	type WalkPlan,
} from '@server/places/model/places.schema';
import { rankPlaces } from '@server/places/model/rank';
import { planWalk } from '@server/places/model/route';
import { getPlaceById, readPlaces } from '@server/places/repo/places';
import { readVectors } from '@server/places/repo/vectors';
import 'server-only';

export interface RankInput {
	accessibleOnly?: boolean;
	at: Date;
	categories?: Category[];
	limit: number;
	maxWalkMinutes: number;
	origin: GeoPoint;
	places: readonly Place[];
	semantic: Map<string, number>;
}

export interface PlaceVectors {
	byId: Map<string, Float32Array>;
	dims: number;
	model: string;
}

/** Explicit seams for isolated usecase tests; production always uses the real modules below. */
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

export const placesDependencies: PlacesDependencies = {
	getPlaceById,
	lexicalScores,
	planWalk,
	rankPlaces,
	readPlaces,
	readVectors,
};
