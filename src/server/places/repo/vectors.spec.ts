import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import 'server-only';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

const dataset = JSON.stringify([{ id: 'osm:node/1' }]);
const vector = Array.from({ length: 256 }, (_, index) => (index === 0 ? 1 : 0));
const valid = () => ({
	byId: { 'osm:node/1': vector },
	datasetSha256: createHash('sha256').update(dataset).digest('hex'),
	dims: 256,
	model: 'text-embedding-3-small',
});

beforeEach(() => {
	vi.resetModules();
	vi.mocked(existsSync).mockReset().mockReturnValue(true);
	vi.mocked(readFileSync).mockReset();
});

function files(payload: unknown) {
	vi.mocked(readFileSync).mockImplementation((path) =>
		String(path).endsWith('poi.vectors.json') ? JSON.stringify(payload) : dataset,
	);
}

describe('optional place vectors', () => {
	it('loads multilingual local vectors without confusing their dimensions with OpenAI', async () => {
		files({
			...valid(),
			byId: { 'osm:node/1': [1, ...Array<number>(383).fill(0)] },
			dims: 384,
			model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
		});
		const { readVectors } = await import('./vectors');
		expect(readVectors()?.dims).toBe(384);
	});
	it('caches absence without repeatedly checking the filesystem', async () => {
		vi.mocked(existsSync).mockReturnValue(false);
		const { readVectors } = await import('./vectors');
		expect(readVectors()).toBeNull();
		expect(readVectors()).toBeNull();
		expect(existsSync).toHaveBeenCalledTimes(1);
		expect(readFileSync).not.toHaveBeenCalled();
	});
	it('loads finite nonzero float32 vectors and caches the result', async () => {
		files(valid());
		const { readVectors } = await import('./vectors');
		const result = readVectors();
		expect(result?.byId.get('osm:node/1')).toEqual(new Float32Array(vector));
		expect(result?.dims).toBe(256);
		expect(result?.model).toBe('text-embedding-3-small');
		const reads = vi.mocked(readFileSync).mock.calls.length;
		expect(readVectors()).toBe(result);
		expect(readFileSync).toHaveBeenCalledTimes(reads);
	});
	it.each([
		{ ...valid(), dims: 1536 },
		{ ...valid(), model: 'other-model' },
		{ ...valid(), byId: {} },
		{ ...valid(), byId: { 'osm:node/1': [1] } },
		{ ...valid(), byId: { 'osm:node/1': Array.from({ length: 256 }, () => 0) } },
		{ ...valid(), byId: { 'osm:node/1': vector.map(() => 1e100) } },
		{ ...valid(), byId: { 'osm:node/1': vector.map(() => 1e-100) } },
		{ ...valid(), byId: { 'not-an-osm-id': vector } },
		{ ...valid(), datasetSha256: '0'.repeat(64) },
		{ ...valid(), datasetSha256: undefined },
	])('rejects unusable or stale files without throwing: %j', async (payload) => {
		files(payload);
		const { readVectors } = await import('./vectors');
		expect(readVectors()).toBeNull();
		const reads = vi.mocked(readFileSync).mock.calls.length;
		expect(readVectors()).toBeNull();
		expect(readFileSync).toHaveBeenCalledTimes(reads);
	});
	it('keeps lexical fallback available for malformed JSON and read failures', async () => {
		vi.mocked(readFileSync).mockReturnValue('{broken');
		const { readVectors } = await import('./vectors');
		expect(readVectors()).toBeNull();
		vi.resetModules();
		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error('unreadable');
		});
		const reloaded = await import('./vectors');
		expect(reloaded.readVectors()).toBeNull();
	});
});
