import { z } from 'zod';

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const coordinateSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** Optional navigation detail on a plan_walk result; the frozen places contract is unchanged. */
export const walkingRouteSchema = z.discriminatedUnion('status', [
	z.object({
		collectedAt: z.string().min(1),
		distanceM: z.number().nonnegative(),
		legs: z
			.array(
				z.object({
					distanceM: z.number().nonnegative(),
					from: pointSchema,
					fromOffsetM: z.number().min(0).max(75),
					geometry: z.object({
						coordinates: z.array(coordinateSchema).min(2).max(100000),
						type: z.literal('LineString'),
					}),
					to: pointSchema,
					toOffsetM: z.number().min(0).max(75),
					walkMinutes: z.number().nonnegative(),
				}),
			)
			.min(1)
			.max(3),
		note: z.string().min(1),
		source: z.literal('OpenStreetMap'),
		status: z.literal('available'),
		stopIds: z.array(z.string()).min(1).max(3),
		totalMinutes: z.number().nonnegative(),
		walkMinutes: z.number().nonnegative(),
	}),
	z.object({ note: z.string().min(1), status: z.literal('unavailable') }),
]);

export type WalkingRoute = z.infer<typeof walkingRouteSchema>;
