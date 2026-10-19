import { z } from 'zod';

/** Shared contract for collection, algorithms, tools and the map. No server dependencies. */
export const CATEGORIES = [
	'cafe',
	'restaurant',
	'fast_food',
	'bar',
	'nightclub',
	'museum',
	'gallery',
	'theatre',
	'cinema',
	'park',
	'garden',
	'playground',
	'viewpoint',
	'attraction',
	'monument',
	'artwork',
	'mall',
	'library',
	'zoo',
	'theme_park',
	'sports',
	'place_of_worship',
	'other',
] as const;

export const categorySchema = z.enum(CATEGORIES);

export const geoPointSchema = z.object({
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
});

const placeIdSchema = z.string().regex(/^osm:(node|way|relation)\/[1-9]\d*$/);
const scoreSchema = z.number().min(0).max(1);
const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const placeSchema = geoPointSchema.extend({
	address: z.string().nullable(),
	category: categorySchema,
	description: z.string().nullable(),
	descriptionSource: z.enum(['osm', 'wikidata', 'generated']).nullable(),
	id: placeIdSchema,
	/** A freely licensed photo from Wikimedia Commons, linked from the place's Wikidata item (P18). */
	image: z
		.object({
			author: z.string().nullable(),
			license: z.string().nullable(),
			pageUrl: z.url(),
			url: z.url(),
		})
		.nullable()
		.optional(),
	name: z.string().trim().min(1),
	nameEn: z.string().nullable(),
	openingHours: z.string().nullable(),
	phone: z.string().nullable(),
	popularity: scoreSchema.nullable(),
	sourceUrl: z.url(),
	tags: z.array(z.string()),
	website: z.string().nullable(),
	wheelchair: z.enum(['yes', 'limited', 'no']).nullable(),
});

export const openStatusSchema = z.object({
	confidence: z.enum(['high', 'low', 'none']),
	note: z.string(),
	opensAt: clockTimeSchema.nullable(),
	status: z.enum(['open', 'closed', 'unknown']),
	until: clockTimeSchema.nullable(),
});

export const candidateSchema = z.object({
	distanceM: z.number().nonnegative(),
	open: openStatusSchema,
	place: placeSchema,
	score: scoreSchema,
	visitMinutes: z.number().nonnegative(),
	walkMinutes: z.number().nonnegative(),
	why: z.object({
		distance: scoreSchema,
		open: scoreSchema,
		popularity: scoreSchema,
		semantic: scoreSchema,
		tags: z.array(z.string()),
	}),
});

export const findPlacesInputSchema = z.object({
	accessibleOnly: z.boolean().optional(),
	// Omitted time is resolved from ctx.now by the usecase, never by the schema.
	at: z.iso.datetime({ offset: true }).optional(),
	categories: z.array(categorySchema).optional(),
	limit: z.number().int().min(1).max(10).default(5),
	maxWalkMinutes: z.number().min(5).max(90).default(15),
	near: geoPointSchema.optional(),
	query: z.string().trim().min(1),
});

export const findPlacesResultSchema = z.object({
	candidates: z.array(candidateSchema),
	note: z.string().nullable(),
	origin: z.object({
		label: z.string().nullable(),
		point: geoPointSchema,
		source: z.enum(['browser', 'text']),
	}),
	usedFilters: z.array(z.string()),
});

export const resolveLocationInputSchema = z.object({
	text: z.string().trim().min(1),
});

export const resolvedLocationSchema = z.object({
	/** Not found: distinct dataset names the user may have meant («Вы про X или Y?»). */
	candidates: z.array(z.string()).optional(),
	confidence: z.enum(['high', 'low']),
	found: z.boolean(),
	label: z.string().nullable(),
	matchedPlaceId: placeIdSchema.nullable(),
	/** Not found: the user's words for the place, so the reply can say what is missing from the data. */
	missing: z.string().optional(),
	point: geoPointSchema.nullable(),
});

export const planWalkInputSchema = z.object({
	categories: z.array(categorySchema).optional(),
	durationMinutes: z.number().min(20).max(240),
	maxStops: z.number().int().min(2).max(3).default(3),
	query: z.string().trim().min(1).optional(),
	start: geoPointSchema,
});

export const walkPlanSchema = z.object({
	legs: z.array(
		z.object({
			distanceM: z.number().nonnegative(),
			from: geoPointSchema,
			to: geoPointSchema,
			walkMinutes: z.number().nonnegative(),
		}),
	),
	note: z.string(),
	stops: z.array(
		z.object({
			arriveAtMinute: z.number().nonnegative(),
			candidate: candidateSchema,
			order: z.number().int().min(1),
		}),
	),
	totalMinutes: z.number().nonnegative(),
});

export const getPlaceInputSchema = z.object({ id: placeIdSchema });

export type Category = z.infer<typeof categorySchema>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
export type Place = z.infer<typeof placeSchema>;
export type OpenStatus = z.infer<typeof openStatusSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
/** Parsed tool arguments: defaults have already been filled by Zod. */
export type FindPlacesInput = z.infer<typeof findPlacesInputSchema>;
export type FindPlacesResult = z.infer<typeof findPlacesResultSchema>;
export type ResolveLocationInput = z.infer<typeof resolveLocationInputSchema>;
export type ResolvedLocation = z.infer<typeof resolvedLocationSchema>;
export type PlanWalkInput = z.infer<typeof planWalkInputSchema>;
export type WalkPlan = z.infer<typeof walkPlanSchema>;
export type GetPlaceInput = z.infer<typeof getPlaceInputSchema>;
