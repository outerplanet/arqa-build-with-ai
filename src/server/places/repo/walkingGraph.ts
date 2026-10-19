import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { type WalkingGraphData, walkingGraphSchema } from '../model/walkingGraph.schema';

let cached: WalkingGraphData | null | undefined;

/** Optional public OSM graph, cached until restart. No request coordinates enter this cache. */
export function readWalkingGraph(): WalkingGraphData | null {
	if (cached !== undefined) return cached;
	try {
		cached = walkingGraphSchema.parse(
			JSON.parse(readFileSync(resolve('data/walking-graph.json'), 'utf8')) as unknown,
		);
	} catch {
		cached = null;
	}
	return cached;
}
