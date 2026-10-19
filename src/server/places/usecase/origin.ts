import { chatRequestSchema } from '@server/agent/model/agent.schema';
import { DomainError } from '@server/kernel/errors';
import { type FindPlacesResult, type GeoPoint } from '@server/places/model/places.schema';
import 'server-only';
import { type PlacesContext } from './context';

/** Reuse the chat boundary's rounding rather than keeping a second privacy rule. */
export function roundLocation(point: GeoPoint): GeoPoint {
	return chatRequestSchema.shape.location.unwrap().parse(point);
}

export function origin(ctx: PlacesContext): FindPlacesResult['origin'] {
	if (ctx.browserLocation !== undefined) {
		return { label: null, point: roundLocation(ctx.browserLocation), source: 'browser' };
	}
	if (ctx.resolvedLocation?.found === true && ctx.resolvedLocation.point !== null) {
		return { label: ctx.resolvedLocation.label, point: roundLocation(ctx.resolvedLocation.point), source: 'text' };
	}
	throw new DomainError('validation', { constraint: 'location_required' });
}

/** Models may not substitute an invented starting point for the user's resolved location. */
export function assertOrigin(ctx: PlacesContext, point: GeoPoint): void {
	const expected = origin(ctx).point;
	const actual = roundLocation(point);

	if (actual.lat !== expected.lat || actual.lon !== expected.lon) {
		throw new DomainError('validation', { constraint: 'location_mismatch' });
	}
}
