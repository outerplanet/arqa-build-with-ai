import { createClient, withRetry } from '@server/agent/usecase/client';
import { readEnv } from '@server/kernel/env';
import { type Place } from '@server/places/model/places.schema';
import 'server-only';
import { dependencies, type PlacesContext } from './context';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 256;

function normalize(vector: Float32Array | readonly number[], dimensions: number): number[] | null {
	if (vector.length !== dimensions) return null;
	let scale = 0;

	for (const value of vector) {
		if (!Number.isFinite(value)) return null;
		scale = Math.max(scale, Math.abs(value));
	}
	if (scale === 0) return null;
	// Scale first: squaring very large or small finite coordinates can overflow or underflow.
	const scaled = Array.from(vector, (value) => value / scale);
	const norm = Math.hypot(...scaled);

	return scaled.map((value) => value / norm);
}

function cosine(query: readonly number[], vector: readonly number[]): number {
	let dot = 0;

	for (let index = 0; index < query.length; index += 1) {
		dot += query[index]! * vector[index]!;
	}

	return Math.max(-1, Math.min(1, dot));
}

export async function semanticScores(
	ctx: PlacesContext,
	input: { places: readonly Place[]; query: string },
): Promise<{
	note: string | null;
	scores: Map<string, number>;
	similarities?: Map<string, number>;
}> {
	const deps = dependencies(ctx);
	const lexical = () => ({
		note: 'Использован лексический поиск без эмбеддингов.',
		scores: deps.lexicalScores(input.query, input.places),
	});
	try {
		// Only a direct OpenAI connection embeds the query. Mock and third-party endpoints never
		// receive it, so the demo without a key stays offline and uses lexical search.
		const env = readEnv();
		if (env.LLM_PROVIDER !== 'responses' || env.LLM_BASE_URL !== undefined || env.LLM_API_KEY === undefined)
			return lexical();
		const vectors = deps.readVectors();

		if (vectors?.model !== EMBEDDING_MODEL || vectors.dims !== EMBEDDING_DIMENSIONS) return lexical();
		const normalizedVectors = new Map<string, number[]>();

		for (const place of input.places) {
			const vector = vectors.byId.get(place.id);
			const normalized = vector === undefined ? null : normalize(vector, EMBEDDING_DIMENSIONS);

			if (normalized !== null) normalizedVectors.set(place.id, normalized);
		}
		// There is nothing to compare to; do not disclose a query for an unusable dataset.
		if (normalizedVectors.size === 0) return lexical();
		const response = await withRetry(() =>
			createClient().embeddings.create(
				{
					dimensions: EMBEDDING_DIMENSIONS,
					encoding_format: 'float',
					input: input.query,
					model: EMBEDDING_MODEL,
				},
				{ maxRetries: 0, timeout: 8000 },
			),
		);
		// The SDK types are not a runtime guarantee: shape, model and numbers are checked here.
		const embedding = response.data[0]?.embedding;

		if (!Array.isArray(embedding) || response.model !== EMBEDDING_MODEL) return lexical();
		const query = normalize(embedding, EMBEDDING_DIMENSIONS);

		if (query === null) return lexical();
		const scores = deps.lexicalScores(input.query, input.places);
		const similarities = new Map<string, number>();
		let matched = 0;

		for (const place of input.places) {
			const vector = normalizedVectors.get(place.id);
			const score = vector === undefined ? null : cosine(query, vector);

			if (score !== null) {
				scores.set(place.id, Math.max(0, score));
				similarities.set(place.id, score);
				matched += 1;
			}
		}

		return {
			note:
				matched === input.places.length
					? null
					: 'Для части мест использован лексический поиск: подходящие векторы отсутствуют.',
			scores,
			similarities,
		};
	} catch {
		// No provider details or input text in logs, errors or persisted caches.
		return lexical();
	}
}
