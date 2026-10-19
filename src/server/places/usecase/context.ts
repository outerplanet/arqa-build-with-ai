import { type Ctx } from '@server/kernel/ctx';
import { type GeoPoint, type ResolvedLocation } from '@server/places/model/places.schema';
import 'server-only';
import { type PlacesDependencies, placesDependencies } from './dependencies';

/** Request-scoped only. Never persist location or resolution between requests. */
export interface PlacesContext extends Ctx {
	browserLocation?: GeoPoint;
	places?: PlacesDependencies;
	resolvedLocation?: ResolvedLocation;
}

export function dependencies(ctx: PlacesContext): PlacesDependencies {
	return ctx.places ?? placesDependencies;
}
