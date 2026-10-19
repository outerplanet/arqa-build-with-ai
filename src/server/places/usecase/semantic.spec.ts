import { resetEnvCache } from '@server/kernel/env';
import { type Place } from '@server/places/model/places.schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { type PlacesDependencies, type PlaceVectors } from './dependencies';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, semanticScores } from './semantic';

const sdk = vi.hoisted(() => ({ create: vi.fn(), createClient: vi.fn() }));
const local = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock('./localEmbedding', () => ({ localEmbedding: local.embed }));
vi.mock('@server/agent/usecase/client', () => ({
	createClient: sdk.createClient,
	withRetry: <T>(call: () => Promise<T>) => call(),
}));

const places: Place[] = [1, 2, 3].map((id) => ({
	address: null,
	category: 'museum',
	description: null,
	descriptionSource: null,
	id: `osm:node/${id}`,
	lat: 51.1,
	lon: 71.4,
	name: `Fixture ${id}`,
	nameEn: null,
	openingHours: null,
	phone: null,
	popularity: null,
	sourceUrl: `https://www.openstreetmap.org/node/${id}`,
	tags: [],
	website: null,
	wheelchair: null,
}));
const query = 'Музей возле 51.123, 71.456';
const lexical = new Map(places.map((place, index) => [place.id, 0.1 * (index + 1)]));

function vector(first = 1, second = 0): number[] {
	return [first, second, ...Array<number>(EMBEDDING_DIMENSIONS - 2).fill(0)];
}

function fixture(
	vectors: PlaceVectors | null = {
		byId: new Map(places.map((place) => [place.id, new Float32Array(vector())])),
		dims: EMBEDDING_DIMENSIONS,
		model: EMBEDDING_MODEL,
	},
): { ctx: PlacesContext; deps: PlacesDependencies } {
	const deps: PlacesDependencies = {
		getPlaceById: vi.fn(() => null),
		lexicalScores: vi.fn(() => new Map(lexical)),
		planWalk: vi.fn(),
		rankPlaces: vi.fn(),
		readPlaces: vi.fn(() => places),
		readVectors: vi.fn(() => vectors),
	};
	return { ctx: { now: new Date('2026-10-19T08:00:00Z'), places: deps }, deps };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('EMBEDDING_PROVIDER', 'openai');
	vi.stubEnv('EMBEDDING_MODEL', '');
	vi.stubEnv('LLM_PROVIDER', 'responses');
	vi.stubEnv('LLM_BASE_URL', '');
	vi.stubEnv('LLM_API_KEY', 'test-fixture-key');
	resetEnvCache();
	sdk.createClient.mockReturnValue({ embeddings: { create: sdk.create } });
	sdk.create.mockResolvedValue({ data: [{ embedding: vector() }], model: EMBEDDING_MODEL });
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('semantic search provider boundaries', () => {
	it.each([
		{ chat: 'mock', provider: 'local' },
		{ chat: 'mock', provider: '' },
		{ chat: 'responses', provider: 'local' },
	])(
		'uses local vectors without chat credentials or OpenAI (provider=$provider, chat=$chat)',
		async ({ chat, provider }) => {
			vi.stubEnv('EMBEDDING_PROVIDER', provider);
			vi.stubEnv('LLM_PROVIDER', chat);
			vi.stubEnv('LLM_API_KEY', '');
			const model = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
			const embedding = [1, ...Array<number>(383).fill(0)];
			local.embed.mockResolvedValue({ embedding, model });
			const { ctx, deps } = fixture({
				byId: new Map(places.map((place) => [place.id, new Float32Array(embedding)])),
				dims: 384,
				model,
			});
			const result = await semanticScores(ctx, { places, query });
			expect(result.note).toBeNull();
			expect(result.scores.get(places[0]!.id)).toBe(1);
			expect(local.embed).toHaveBeenCalledWith(query);
			expect(deps.readVectors).toHaveBeenCalledTimes(1);
			expect(sdk.createClient).not.toHaveBeenCalled();
		},
	);
	it('falls back when the offline model is unavailable without exposing private text', async () => {
		vi.stubEnv('EMBEDDING_PROVIDER', 'local');
		const model = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
		local.embed.mockRejectedValue(new Error(query));
		const { ctx } = fixture({
			byId: new Map(places.map((place) => [place.id, new Float32Array([1, ...Array<number>(383).fill(0)])])),
			dims: 384,
			model,
		});
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores).toEqual(lexical);
		expect(result.note).not.toContain(query);
	});
	it.each([
		{ baseURL: '', provider: 'mock' },
		{ baseURL: '', provider: 'chat' },
		{ baseURL: 'https://provider.invalid/v1', provider: 'chat' },
		{ baseURL: 'https://provider.invalid/v1', provider: 'responses' },
		{ baseURL: 'https://api.openai.com/v1', provider: 'responses' },
	])('stays offline for $provider with base URL "$baseURL"', async ({ baseURL, provider }) => {
		vi.stubEnv('LLM_PROVIDER', provider);
		vi.stubEnv('LLM_BASE_URL', baseURL);
		const { ctx, deps } = fixture();
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores).toEqual(lexical);
		expect(result.note).toContain('лексический');
		expect(deps.readVectors).not.toHaveBeenCalled();
		expect(sdk.createClient).not.toHaveBeenCalled();
		expect(sdk.create).not.toHaveBeenCalled();
	});

	it('runs mock without an API key', async () => {
		vi.stubEnv('LLM_PROVIDER', 'mock');
		vi.stubEnv('LLM_API_KEY', '');
		const { ctx } = fixture();
		expect((await semanticScores(ctx, { places, query })).scores).toEqual(lexical);
		expect(sdk.createClient).not.toHaveBeenCalled();
	});

	it.each([
		null,
		{ byId: new Map(), dims: EMBEDDING_DIMENSIONS, model: 'wrong-model' },
		{ byId: new Map(), dims: 1536, model: EMBEDDING_MODEL },
		{ byId: new Map(), dims: EMBEDDING_DIMENSIONS, model: EMBEDDING_MODEL },
		{
			byId: new Map([[places[0]!.id, new Float32Array([1])]]),
			dims: EMBEDDING_DIMENSIONS,
			model: EMBEDDING_MODEL,
		},
	])('uses lexical search without network when dataset vectors are unusable: %j', async (vectors) => {
		const { ctx } = fixture(vectors);
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores).toEqual(lexical);
		expect(result.note).toContain('лексический');
		expect(sdk.createClient).not.toHaveBeenCalled();
	});
});

describe('semantic search response handling', () => {
	it.each([
		undefined,
		{},
		{ data: null, model: EMBEDDING_MODEL },
		{ data: [], model: EMBEDDING_MODEL },
		{ data: [{ embedding: vector() }], model: 'wrong-model' },
		{ data: [{ embedding: [1] }], model: EMBEDDING_MODEL },
		{ data: [{ embedding: vector(Number.NaN) }], model: EMBEDDING_MODEL },
		{ data: [{ embedding: vector(Number.POSITIVE_INFINITY) }], model: EMBEDDING_MODEL },
		{ data: [{ embedding: vector(0) }], model: EMBEDDING_MODEL },
		{ data: [{ embedding: 'malformed' }], model: EMBEDDING_MODEL },
		{ data: [{ embedding: ['1', ...vector().slice(1)] }], model: EMBEDDING_MODEL },
	])('falls back cleanly for an unusable embedding response: %j', async (response) => {
		sdk.create.mockResolvedValue(response);
		const { ctx } = fixture();
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores).toEqual(lexical);
		expect(result.note).toBe('Использован лексический поиск без эмбеддингов.');
	});

	it('hides provider rejection details and sensitive query text in the fallback', async () => {
		sdk.create.mockRejectedValue(new Error(`test-fixture-key: ${query}`));
		const { ctx } = fixture();
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores).toEqual(lexical);
		expect(JSON.stringify(result)).not.toContain(query);
		expect(JSON.stringify(result)).not.toContain('test-fixture-key');
	});

	it('uses normalized cosine scores, independent of vector magnitude', async () => {
		const { ctx } = fixture({
			byId: new Map([
				[places[0]!.id, new Float32Array(vector(30, 40))],
				[places[1]!.id, new Float32Array(vector(0, 7))],
				[places[2]!.id, new Float32Array(vector(-2))],
			]),
			dims: EMBEDDING_DIMENSIONS,
			model: EMBEDDING_MODEL,
		});
		const result = await semanticScores(ctx, { places, query });
		expect(result.note).toBeNull();
		expect(result.scores.get(places[0]!.id)).toBeCloseTo(0.6);
		expect(result.scores.get(places[1]!.id)).toBe(0);
		expect(result.scores.get(places[2]!.id)).toBe(0);
		expect(result.similarities?.get(places[2]!.id)).toBe(-1);
		expect(sdk.create).toHaveBeenCalledWith(
			{ dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float', input: query, model: EMBEDDING_MODEL },
			{ maxRetries: 0, timeout: 8000 },
		);
	});

	it.each([undefined, new Float32Array([1]), new Float32Array(vector(0)), new Float32Array(vector(Number.NaN))])(
		'keeps lexical scores only for missing or invalid place vectors: %j',
		async (invalidVector) => {
			const byId = new Map([[places[0]!.id, new Float32Array(vector())]]);
			if (invalidVector !== undefined) byId.set(places[1]!.id, invalidVector);
			const { ctx } = fixture({ byId, dims: EMBEDDING_DIMENSIONS, model: EMBEDDING_MODEL });
			const result = await semanticScores(ctx, { places, query });
			expect(result.scores).toEqual(
				new Map([
					[places[0]!.id, 1],
					[places[1]!.id, 0.2],
					[places[2]!.id, 0.1 * 3],
				]),
			);
			expect(result.note).toContain('части мест');
		},
	);

	it('keeps finite cosine scores even for large finite query coordinates', async () => {
		sdk.create.mockResolvedValue({ data: [{ embedding: vector(1e200) }], model: EMBEDDING_MODEL });
		const { ctx } = fixture();
		const result = await semanticScores(ctx, { places, query });
		expect(result.scores.get(places[0]!.id)).toBe(1);
	});

	it('does not retain inputs or cache query embeddings across requests', async () => {
		const { ctx, deps } = fixture();
		const ctxBefore = { ...ctx };
		const placesBefore = structuredClone(places);
		await semanticScores(ctx, Object.freeze({ places, query }));
		sdk.create.mockResolvedValueOnce({ data: [{ embedding: vector(0, 1) }], model: EMBEDDING_MODEL });
		const second = await semanticScores(ctx, { places, query: 'Другой запрос' });
		expect(sdk.create).toHaveBeenCalledTimes(2);
		expect(sdk.create).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ input: 'Другой запрос' }),
			expect.any(Object),
		);
		expect(second.scores.get(places[0]!.id)).toBe(0);
		expect(ctx).toEqual(ctxBefore);
		expect(places).toEqual(placesBefore);
		expect(deps.readVectors).toHaveBeenCalledTimes(2);
	});
});
