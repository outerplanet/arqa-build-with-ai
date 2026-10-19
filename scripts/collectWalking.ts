/* eslint-disable no-console -- Offline public-data collection reports its progress to the operator. */
/* eslint-disable no-await-in-loop -- Mirrors are tried sequentially to respect public API capacity. */
/* eslint-disable no-continue -- Unsupported source objects are rejected before graph edges are expanded. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type WalkingGraphData, walkingGraphSchema } from '../src/server/places/model/walkingGraph.schema';
import { publishCollection } from '../src/server/places/repo/publication';

const BBOX = [51.03, 71.25, 51.25, 71.65] as const;
const NORMAL = new Set([
	'footway',
	'living_street',
	'path',
	'pedestrian',
	'residential',
	'service',
	'steps',
	'tertiary',
	'tertiary_link',
	'unclassified',
]);
const EXPLICIT = new Set(['cycleway', 'primary', 'primary_link', 'secondary', 'secondary_link', 'track']);
const ALLOWED = new Set(['designated', 'official', 'permissive', 'yes']);
const PASSABLE_BARRIERS = new Set(['bollard', 'entrance', 'no']);

export const WALKING_QUERY = `[out:json][timeout:40][bbox:${BBOX.join(',')}];way["highway"~"^(footway|pedestrian|path|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|primary|primary_link|secondary|secondary_link|cycleway|track)$"]["area"!="yes"]["motorroad"!="yes"]["indoor"!="yes"]->.walking;.walking out body;node(w.walking);out body qt;`;

const elementSchema = z.object({
	id: z.number().int().positive(),
	lat: z.number().optional(),
	lon: z.number().optional(),
	nodes: z.array(z.number().int().positive()).optional(),
	tags: z.record(z.string(), z.string()).default({}),
	type: z.enum(['node', 'way', 'relation']),
});
const responseSchema = z.object({
	elements: z.array(elementSchema),
	osm3s: z.object({ timestamp_osm_base: z.string() }),
	remark: z.string().optional(),
});
type Tags = Record<string, string>;

function allowedAccess(tags: Tags): boolean {
	if (
		Object.keys(tags).some(
			(key) =>
				key.startsWith('access:') ||
				key.startsWith('foot:') ||
				key === 'oneway:foot:conditional' ||
				key === 'opening_hours:conditional',
		)
	)
		return false;
	if (tags.access !== undefined && !ALLOWED.has(tags.access)) return false;
	if (tags.foot !== undefined && !ALLOWED.has(tags.foot)) return false;
	if (tags.indoor !== undefined && tags.indoor !== 'no') return false;
	if (tags.locked !== undefined && tags.locked !== 'no') return false;
	if (tags.opening_hours !== undefined && tags.opening_hours !== '24/7') return false;
	if (tags.construction !== undefined || tags.proposed !== undefined || tags.disused === 'yes') return false;
	if (tags.ford !== undefined && tags.ford !== 'no') return false;
	return true;
}

/** Filter before connecting consecutive original nodes, so a missing/barred vertex is never skipped. */
export function buildWalkingGraph(input: unknown, collectedAt: string): WalkingGraphData {
	const response = responseSchema.parse(input);
	if (response.remark !== undefined) throw new Error('Incomplete Overpass response');
	const sourceNodes = new Map(
		response.elements.filter((element) => element.type === 'node').map((element) => [element.id, element]),
	);
	const nodes: WalkingGraphData['nodes'] = [];
	const edges: WalkingGraphData['edges'] = [];
	const indices = new Map<number, number>();
	const seen = new Set<string>();
	function nodeIndex(osmId: number): number | null {
		const node = sourceNodes.get(osmId);
		if (node?.lat === undefined || node.lon === undefined || !allowedAccess(node.tags)) return null;
		if (node.tags.barrier !== undefined && !PASSABLE_BARRIERS.has(node.tags.barrier)) return null;
		if (node.tags.highway === 'elevator' || node.tags.highway === 'ford') return null;
		let found = indices.get(osmId);
		if (found === undefined) {
			found = nodes.length;
			indices.set(osmId, found);
			nodes.push([osmId, node.lat, node.lon]);
		}
		return found;
	}
	for (const way of response.elements) {
		if (way.type !== 'way' || way.nodes === undefined || !allowedAccess(way.tags)) continue;
		const highway = way.tags.highway ?? '';
		if (!NORMAL.has(highway) && !(EXPLICIT.has(highway) && ALLOWED.has(way.tags.foot ?? ''))) continue;
		if (way.tags.area === 'yes' || way.tags.motorroad === 'yes') continue;
		const direction = way.tags['oneway:foot'] ?? 'no';
		if (!['-1', '0', '1', 'false', 'no', 'true', 'yes'].includes(direction)) continue;
		for (let i = 1; i < way.nodes.length; i += 1) {
			const from = nodeIndex(way.nodes[i - 1]!);
			const to = nodeIndex(way.nodes[i]!);
			if (from === null || to === null || from === to) continue;
			const a = nodes[from]!;
			const b = nodes[to]!;
			if (a[1] === b[1] && a[2] === b[2]) continue;
			const directions: [number, number][] =
				direction === '-1'
					? [[to, from]]
					: ['1', 'true', 'yes'].includes(direction)
						? [[from, to]]
						: [
								[from, to],
								[to, from],
							];
			for (const [start, end] of directions) {
				const key = `${start}/${end}/${way.id}`;
				if (!seen.has(key)) edges.push([start, end, way.id]);
				seen.add(key);
			}
		}
	}
	if (edges.length === 0) throw new Error('Empty walking graph after access filtering');
	return walkingGraphSchema.parse({ bbox: BBOX, collectedAt, edges, nodes, source: 'OpenStreetMap', version: 1 });
}

function componentSummary(graph: WalkingGraphData) {
	const parents = graph.nodes.map((_, index) => index);
	function find(start: number): number {
		let index = start;
		while (parents[index] !== index) {
			parents[index] = parents[parents[index]!]!;
			index = parents[index]!;
		}
		return index;
	}
	for (const [a, b] of graph.edges) parents[find(a)] = find(b);
	const sizes = new Map<number, number>();
	for (let i = 0; i < parents.length; i += 1) {
		const root = find(i);
		sizes.set(root, (sizes.get(root) ?? 0) + 1);
	}
	return { components: sizes.size, largestComponentNodes: Math.max(...sizes.values()) };
}

async function main() {
	let response: z.infer<typeof responseSchema> | undefined;
	let endpoint = '';
	const rawFile = process.env.WALKING_RAW_FILE;
	if (rawFile) response = responseSchema.parse(JSON.parse(await readFile(rawFile, 'utf8')) as unknown);
	else
		for (const mirror of [
			'https://overpass-api.de/api/interpreter',
			'https://overpass.private.coffee/api/interpreter',
			'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
		]) {
			try {
				const result = await fetch(`${mirror}?${new URLSearchParams({ data: WALKING_QUERY }).toString()}`, {
					headers: { 'User-Agent': 'AstanaWalks/1.0 (https://github.com/outerplanet/arqa-build-with-ai)' },
					signal: AbortSignal.timeout(45000),
				});
				if (!result.ok) throw new Error(`HTTP ${result.status}`);
				response = responseSchema.parse(await result.json());
				if (response.remark !== undefined) throw new Error('Incomplete Overpass result');
				endpoint = mirror;
				break;
			} catch {
				console.error('Не удалось загрузить граф с зеркала Overpass; пробуем следующее.');
			}
		}
	if (response === undefined) throw new Error('Сбор графа не завершён, прежние файлы сохранены.');
	const graph = buildWalkingGraph(response, new Date().toISOString());
	const serialized = `${JSON.stringify(graph)}\n`;
	const summary = {
		...componentSummary(graph),
		bbox: BBOX,
		collectedAt: graph.collectedAt,
		directedEdges: graph.edges.length,
		endpoint: endpoint || 'WALKING_RAW_FILE',
		graphBytes: Buffer.byteLength(serialized),
		graphSha256: createHash('sha256').update(serialized).digest('hex'),
		license: 'ODbL-1.0',
		nodes: graph.nodes.length,
		osmTimestamp: response.osm3s.timestamp_osm_base,
		policy:
			'Conservative public pedestrian access; unknown, directional and conditional foot/access restrictions, gates, indoor paths, fords, motorways and motorroads excluded. Shared OSM nodes only; no inferred connections or endpoint connectors. Steps allowed; wheelchair routing unsupported.',
		query: WALKING_QUERY,
		querySha256: createHash('sha256').update(WALKING_QUERY).digest('hex'),
		source: 'OpenStreetMap',
		sourceUrl: 'https://www.openstreetmap.org/copyright',
		ways: new Set(graph.edges.map((edge) => edge[2])).size,
	};
	await publishCollection('data', {
		'walking-graph.json': serialized,
		'walking-summary.json': `${JSON.stringify(summary, null, 2)}\n`,
	});
	console.log(`Граф сохранён: ${graph.nodes.length} узлов, ${graph.edges.length} направленных рёбер.`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(() => {
		console.error('Не удалось собрать пешеходный граф; проверьте доступность Overpass.');
		process.exitCode = 1;
	});
}
