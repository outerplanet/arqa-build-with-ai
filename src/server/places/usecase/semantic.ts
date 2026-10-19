import { createClient, withRetry } from '@server/agent/usecase/client';
import { readEnv } from '@server/kernel/env';
import { type Place } from '@server/places/model/places.schema';
import 'server-only';
import { dependencies, type PlacesContext } from './context';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 256;

function cosine(query: readonly number[], vector: Float32Array): number | null {
	if (query.length !== vector.length || vector.length !== EMBEDDING_DIMENSIONS) return null;
	let dot = 0;
	let queryNorm = 0;
	let vectorNorm = 0;

	for (let index = 0; index < query.length; index += 1) {
		const left = query[index]!;
		const right = vector[index]!;

		if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
		dot += left * right;
		queryNorm += left * left;
		vectorNorm += right * right;
	}
	if (queryNorm === 0 || vectorNorm === 0) return null;

	return Math.max(0, Math.min(1, dot / Math.sqrt(queryNorm * vectorNorm)));
}

export async function semanticScores(
	ctx: PlacesContext,
	input: { places: readonly Place[]; query: string },
): Promise<{
	note: string | null;
	scores: Map<string, number>;
}> {
	const deps = dependencies(ctx);
	const lexical = () => ({
		note: 'Использован лексический поиск без эмбеддингов.',
		scores: deps.lexicalScores(input.query, input.places),
	});
	const env = readEnv();

	// Never send a third-party provider's credentials to OpenAI; mock must stay offline.
	if (env.LLM_PROVIDER !== 'responses' || env.LLM_BASE_URL !== undefined || env.LLM_API_KEY === undefined) {
		return lexical();
	}
	try {
		const vectors = deps.readVectors();

		if (vectors?.model !== EMBEDDING_MODEL || vectors.dims !== EMBEDDING_DIMENSIONS) return lexical();
		const client = createClient();
		const response = await withRetry(() =>
			client.embeddings.create(
				{
					dimensions: EMBEDDING_DIMENSIONS,
					encoding_format: 'float',
					input: input.query,
					model: EMBEDDING_MODEL,
				},
				{ maxRetries: 0, timeout: 8000 },
			),
		);
		const query = response.data[0]?.embedding;

		if (query === undefined || response.model !== EMBEDDING_MODEL) return lexical();
		const scores = deps.lexicalScores(input.query, input.places);
		let matched = 0;

		for (const place of input.places) {
			const vector = vectors.byId.get(place.id);
			const score = vector === undefined ? null : cosine(query, vector);

			if (score !== null) {
				scores.set(place.id, score);
				matched += 1;
			}
		}

		return {
			note:
				matched === input.places.length
					? null
					: 'Для части мест использован лексический поиск: подходящие векторы отсутствуют.',
			scores,
		};
	} catch {
		// No provider details or input text in logs, errors or persisted caches.
		return lexical();
	}
}
