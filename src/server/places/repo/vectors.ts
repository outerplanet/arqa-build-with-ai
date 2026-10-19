import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { z } from 'zod';

const vectorsSchema = z.object({
	byId: z.record(z.string(), z.array(z.number()).length(256)),
	dims: z.literal(256),
	model: z.literal('text-embedding-3-small'),
});
interface PlaceVectors {
	byId: Map<string, Float32Array>;
	dims: number;
	model: string;
}
let cached: PlaceVectors | null | undefined;

/** A missing or incompatible optional file keeps lexical search available. */
export function readVectors(): PlaceVectors | null {
	if (cached !== undefined) return cached;
	const path = resolve('data/poi.vectors.json');
	if (!existsSync(path)) return null;
	try {
		const parsed = vectorsSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
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
