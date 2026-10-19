import { DomainError } from '@server/kernel/errors';
import { getPlaceInputSchema, type Place, placeSchema } from '@server/places/model/places.schema';
import 'server-only';
import { type z } from 'zod';
import { dependencies, type PlacesContext } from './context';

export function getPlace(ctx: PlacesContext, input: z.input<typeof getPlaceInputSchema>): Place {
	const parsed = getPlaceInputSchema.parse(input);
	const place = dependencies(ctx).getPlaceById(parsed.id);

	if (place === null) throw new DomainError('validation', { constraint: 'place_not_found' });

	return placeSchema.parse(place);
}
