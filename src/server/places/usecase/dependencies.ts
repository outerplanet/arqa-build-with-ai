import { DomainError } from '@server/kernel/errors';
import {
	type Candidate,
	type Category,
	type GeoPoint,
	type Place,
	type WalkPlan,
} from '@server/places/model/places.schema';
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

/** Replace the pending functions here with imports from the repo and algorithm lanes. */
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
	lexicalScores: unavailable,
	planWalk: unavailable,
	rankPlaces: unavailable,
	readPlaces: unavailable,
	readVectors: () => null,
};
