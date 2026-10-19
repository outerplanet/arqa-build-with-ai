import 'server-only';
import { describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { semanticScores } from './semantic';
import { vectorSearch } from './vectorSearch';

vi.mock('./semantic', () => ({
	semanticScores: vi.fn(() =>
		Promise.resolve({
			note: null,
			scores: new Map([
				['osm:node/1', 0.9],
				['osm:node/2', 0.3],
			]),
			similarities: new Map([
				['osm:node/1', 0.9],
				['osm:node/2', -0.3],
			]),
		}),
	),
}));

describe('vector search retrieval', () => {
	it('does not mix lexical-only records with cosine top_k when vectors partially cover the dataset', async () => {
		const places = [1, 2].map((id) => ({
			category: 'museum',
			description: null,
			id: `osm:node/${id}`,
			name: `Музей ${id}`,
			tags: [],
		}));
		const ctx = { places: { readPlaces: () => places } } as unknown as PlacesContext;
		vi.mocked(semanticScores).mockResolvedValueOnce({
			note: 'Для части мест использован лексический поиск.',
			scores: new Map([
				['osm:node/1', 0],
				['osm:node/2', 0.9],
			]),
			similarities: new Map([['osm:node/1', -0.2]]),
		});
		const result = await vectorSearch(ctx, { query: 'культура', topK: 5 });
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.metadata.id).toBe('osm:node/1');
		expect(result.results[0]?.similarity).toBe(-0.2);
	});
	it('returns ordered text and metadata and respects topK', async () => {
		const places = [2, 1].map((id) => ({
			category: 'museum',
			description: 'Описание из источника',
			id: `osm:node/${id}`,
			name: `Музей ${id}`,
			tags: [],
		}));
		const ctx = { places: { readPlaces: () => places } } as unknown as PlacesContext;
		const result = await vectorSearch(ctx, { query: 'культура', topK: 1 });
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.metadata).toEqual(places[1]);
		expect(result.results[0]?.text).toContain('Описание из источника');
		expect(result.results[0]?.similarity).toBe(0.9);
	});
	it('validates external input before loading data', async () => {
		const readPlaces = vi.fn();
		const ctx = { places: { readPlaces } } as unknown as PlacesContext;
		await expect(vectorSearch(ctx, { query: '', topK: 0 })).rejects.toThrow();
		expect(readPlaces).not.toHaveBeenCalled();
	});
});
