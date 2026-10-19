import 'server-only';
import { z } from 'zod';
import { dependencies, type PlacesContext } from './context';
import { semanticScores } from './semantic';

const inputSchema = z.object({
	query: z.string().trim().min(1).max(20000),
	topK: z.number().int().min(1).max(100).default(5),
});

/** Retrieve source text and original POI metadata; note explicitly identifies lexical fallback. */
export async function vectorSearch(ctx: PlacesContext, input: { query: string; topK?: number }) {
	const parsed = inputSchema.parse(input);
	const places = dependencies(ctx).readPlaces();
	const { note, scores, similarities } = await semanticScores(ctx, { places, query: parsed.query });
	return {
		note,
		results: places
			.filter((place) => similarities === undefined || similarities.has(place.id))
			.map((place) => ({
				metadata: place,
				score: scores.get(place.id) ?? 0,
				similarity: similarities?.get(place.id) ?? null,
				text: [place.name, place.category, ...place.tags, place.description].filter(Boolean).join(' · '),
			}))
			.sort(
				(left, right) =>
					(right.similarity ?? right.score) - (left.similarity ?? left.score) ||
					left.metadata.id.localeCompare(right.metadata.id),
			)
			.slice(0, parsed.topK),
	};
}
