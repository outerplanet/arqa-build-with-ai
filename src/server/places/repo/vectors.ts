import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { z } from 'zod';

export const embeddingSchema = z
	.array(z.number())
	.length(256)
	.refine((values) => {
		const vector = new Float32Array(values);
		return vector.every(Number.isFinite) && vector.some((value) => value !== 0);
	}, 'Expected a finite nonzero float32 vector');

export const vectorsSchema = z.object({
	byId: z
		.record(z.string().regex(/^osm:(node|way|relation)\/[1-9]\d*$/), embeddingSchema)
		.refine((byId) => Object.keys(byId).length > 0),
	datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
	dims: z.literal(256),
	model: z.literal('text-embedding-3-small'),
});
interface PlaceVectors {
	byId: Map<string, Float32Array>;
	dims: number;
	model: string;
}
let cached: PlaceVectors | null | undefined;

/** Optional immutable files are cached until restart, including absence and failures. */
export function readVectors(): PlaceVectors | null {
	if (cached !== undefined) return cached;
	try {
		const path = resolve('data/poi.vectors.json');
		if (!existsSync(path)) {
			cached = null;
			return cached;
		}
		const parsed = vectorsSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
		// A changed collection must never silently reuse vectors for old names or descriptions.
		const dataset = readFileSync(resolve('data/poi.json'), 'utf8');
		if (createHash('sha256').update(dataset).digest('hex') !== parsed.datasetSha256) {
			cached = null;
			return cached;
		}
		cached = {
			byId: new Map(Object.entries(parsed.byId).map(([id, vector]) => [id, new Float32Array(vector)])),
			dims: parsed.dims,
			model: parsed.model,
		};
	} catch {
		cached = null;
	}
	return cached;
}
