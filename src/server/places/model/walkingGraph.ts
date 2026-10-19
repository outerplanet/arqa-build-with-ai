import 'server-only';
import { distanceM } from './geo';
import { type GeoPoint } from './places.schema';

export interface WalkingGraphInput {
	edges: readonly (readonly [number, number, number])[];
	nodes: readonly (readonly [number, number, number])[];
}
interface Arc {
	distanceM: number;
	to: number;
}

interface Segment {
	a: number;
	b: number;
	forward: boolean;
	reverse: boolean;
}

export interface WalkingGraphIndex {
	readonly adjacency: readonly (readonly Arc[])[];
	readonly points: readonly GeoPoint[];
	readonly segments: readonly Segment[];
}

export interface WalkingPath {
	coordinates: [number, number][];
	distanceM: number;
	fromSnap: { offsetM: number; point: GeoPoint };
	toSnap: { offsetM: number; point: GeoPoint };
}

function validPoint(point: unknown): point is GeoPoint {
	if (point === null || typeof point !== 'object' || !('lat' in point) || !('lon' in point)) return false;
	return (
		typeof point.lat === 'number' &&
		typeof point.lon === 'number' &&
		Number.isFinite(point.lat) &&
		Number.isFinite(point.lon) &&
		Math.abs(point.lat) <= 90 &&
		Math.abs(point.lon) <= 180
	);
}

function positiveId(id: number): boolean {
	return Number.isSafeInteger(id) && id > 0;
}

function validArrays(input: WalkingGraphInput): boolean {
	return Array.isArray(input.nodes) && Array.isArray(input.edges);
}

/** Only supplied directed edges create connectivity; coincident coordinates never merge nodes. */
export function createWalkingGraph(input: WalkingGraphInput): WalkingGraphIndex {
	if (!validArrays(input)) throw new Error('Invalid walking graph');
	const ids = new Set<number>();
	const points = input.nodes.map(([id, lat, lon]) => {
		if (!positiveId(id) || ids.has(id) || !validPoint({ lat, lon })) throw new Error('Invalid walking graph node');
		ids.add(id);
		return Object.freeze({ lat, lon });
	});
	const adjacency: Arc[][] = points.map(() => []);
	const segments = new Map<string, Segment>();
	for (const [from, to, wayId] of input.edges) {
		if (
			!Number.isInteger(from) ||
			!Number.isInteger(to) ||
			from < 0 ||
			to < 0 ||
			from >= points.length ||
			to >= points.length ||
			!positiveId(wayId)
		)
			throw new Error('Invalid walking graph edge');
		const meters = distanceM(points[from]!, points[to]!);
		if (meters > 0) {
			const a = Math.min(from, to);
			const b = Math.max(from, to);
			const key = `${a}:${b}`;
			const segment = segments.get(key) ?? { a, b, forward: false, reverse: false };
			if (from === a && !segment.forward) adjacency[from]!.push({ distanceM: meters, to });
			if (from === b && !segment.reverse) adjacency[from]!.push({ distanceM: meters, to });
			if (from === a) segment.forward = true;
			else segment.reverse = true;
			segments.set(key, segment);
		}
	}
	return Object.freeze({
		adjacency: Object.freeze(adjacency.map((arcs) => Object.freeze(arcs.sort((a, b) => a.to - b.to)))),
		points: Object.freeze(points),
		segments: Object.freeze(
			[...segments.values()].sort((a, b) => a.a - b.a || a.b - b.b).map((segment) => Object.freeze(segment)),
		),
	});
}

interface Snap {
	offsetM: number;
	point: GeoPoint;
	segment: Segment;
	t: number;
}

function longitudeDelta(value: number): number {
	return value > 180 ? value - 360 : value < -180 ? value + 360 : value;
}

/** Local tangent projection is appropriate for the short OSM street segments of a city graph. */
function project(point: GeoPoint, { a, b }: { a: GeoPoint; b: GeoPoint }): { point: GeoPoint; t: number } {
	const scale = Math.cos(((a.lat + b.lat) * Math.PI) / 360);
	const dx = longitudeDelta(b.lon - a.lon) * scale;
	const dy = b.lat - a.lat;
	const px = longitudeDelta(point.lon - a.lon) * scale;
	const py = point.lat - a.lat;
	const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
	if (t === 0) return { point: a, t };
	if (t === 1) return { point: b, t };
	return { point: { lat: a.lat + t * dy, lon: longitudeDelta(a.lon + t * longitudeDelta(b.lon - a.lon)) }, t };
}

function nearestSegment(
	index: WalkingGraphIndex,
	{ maxSnapM, point }: { maxSnapM: number; point: GeoPoint },
): Snap | null {
	let best: Snap | null = null;
	for (const segment of index.segments) {
		const projection = project(point, { a: index.points[segment.a]!, b: index.points[segment.b]! });
		const offsetM = distanceM(point, projection.point);
		if (offsetM <= maxSnapM && (best === null || offsetM < best.offsetM)) {
			best = { ...projection, offsetM, segment };
		}
	}
	return best;
}

interface QueueEntry {
	cost: number;
	node: number;
	priority: number;
}

function before(a: QueueEntry, b: QueueEntry): boolean {
	return a.priority < b.priority || (a.priority === b.priority && a.node < b.node);
}

class MinHeap {
	private readonly entries: QueueEntry[] = [];

	pop(): QueueEntry | undefined {
		const first = this.entries[0];
		const last = this.entries.pop();
		if (last === undefined || this.entries.length === 0) return first;
		let parent = 0;
		while (parent * 2 + 1 < this.entries.length) {
			let child = parent * 2 + 1;
			if (child + 1 < this.entries.length && before(this.entries[child + 1]!, this.entries[child]!)) child++;
			if (!before(this.entries[child]!, last)) break;
			this.entries[parent] = this.entries[child]!;
			parent = child;
		}
		this.entries[parent] = last;
		return first;
	}

	push(entry: QueueEntry): void {
		let child = this.entries.length;
		this.entries.push(entry);
		while (child > 0) {
			const parent = Math.floor((child - 1) / 2);
			if (!before(entry, this.entries[parent]!)) break;
			this.entries[child] = this.entries[parent]!;
			child = parent;
		}
		this.entries[child] = entry;
	}
}

/** Virtual vertices split existing directed segments without ever adding off-graph connectors. */
function virtualArcs(index: WalkingGraphIndex, { from, to }: { from: Snap; to: Snap }): Map<number, Arc[]> {
	const start = index.points.length;
	const finish = start + 1;
	const extra = new Map<number, Arc[]>();
	const add = (source: number, arc: Arc) => {
		const arcs = extra.get(source) ?? [];
		arcs.push(arc);
		extra.set(source, arcs);
	};
	if (from.t === 0 || from.segment.reverse)
		add(start, { distanceM: distanceM(from.point, index.points[from.segment.a]!), to: from.segment.a });
	if (from.t === 1 || from.segment.forward)
		add(start, { distanceM: distanceM(from.point, index.points[from.segment.b]!), to: from.segment.b });
	if (to.t === 0 || to.segment.forward)
		add(to.segment.a, { distanceM: distanceM(index.points[to.segment.a]!, to.point), to: finish });
	if (to.t === 1 || to.segment.reverse)
		add(to.segment.b, { distanceM: distanceM(index.points[to.segment.b]!, to.point), to: finish });
	if (
		from.segment === to.segment &&
		(from.t === to.t || (from.t <= to.t && from.segment.forward) || (from.t >= to.t && from.segment.reverse))
	)
		add(start, { distanceM: distanceM(from.point, to.point), to: finish });
	return extra;
}

function coordinatesForPath(
	points: readonly GeoPoint[],
	{ finish, previous }: { finish: number; previous: Int32Array },
): [number, number][] {
	const reversed: GeoPoint[] = [];
	let node = finish;
	while (node >= 0) {
		reversed.push(points[node]!);
		node = previous[node]!;
	}
	const coordinates: [number, number][] = [];
	for (const point of reversed.reverse()) {
		const last = coordinates.at(-1);
		if (last?.[0] !== point.lon || last[1] !== point.lat) coordinates.push([point.lon, point.lat]);
	}
	// A zero-distance route still needs a valid GeoJSON LineString.
	if (coordinates.length === 1) coordinates.push([...coordinates[0]!]);
	return coordinates;
}

interface WalkingPathInput {
	from: GeoPoint;
	maxSnapM?: number;
	to: GeoPoint;
}

function snapFor(
	index: WalkingGraphIndex,
	{ cache, maxSnapM, point }: { cache?: Map<string, Snap | null>; maxSnapM: number; point: GeoPoint },
): Snap | null {
	const key = JSON.stringify([point.lat, point.lon, maxSnapM]);
	if (cache?.has(key)) return cache.get(key) ?? null;
	const snap = nearestSegment(index, { maxSnapM, point });
	cache?.set(key, snap);
	return snap;
}

function findPath(
	index: WalkingGraphIndex,
	input: WalkingPathInput & { snaps?: Map<string, Snap | null> },
): WalkingPath | null {
	const maxSnapM = input.maxSnapM ?? 75;
	if (!validPoint(input.from) || !validPoint(input.to) || !Number.isFinite(maxSnapM) || maxSnapM < 0) return null;
	const from = snapFor(index, { cache: input.snaps, maxSnapM, point: input.from });
	const to = snapFor(index, { cache: input.snaps, maxSnapM, point: input.to });
	if (!from || !to) return null;
	const points = [...index.points, from.point, to.point];
	const start = index.points.length;
	const finish = start + 1;
	const extra = virtualArcs(index, { from, to });
	const distances = new Float64Array(points.length).fill(Infinity);
	const previous = new Int32Array(points.length).fill(-1);
	const queue = new MinHeap();
	distances[start] = 0;
	queue.push({ cost: 0, node: start, priority: distanceM(from.point, to.point) });
	let current = queue.pop();
	while (current !== undefined) {
		if (current.cost === distances[current.node]) {
			if (current.node === finish) {
				return {
					coordinates: coordinatesForPath(points, { finish, previous }),
					distanceM: current.cost,
					fromSnap: { offsetM: from.offsetM, point: { ...from.point } },
					toSnap: { offsetM: to.offsetM, point: { ...to.point } },
				};
			}
			for (const arc of [...(index.adjacency[current.node] ?? []), ...(extra.get(current.node) ?? [])]) {
				const cost = current.cost + arc.distanceM;
				if (cost < distances[arc.to]!) {
					distances[arc.to] = cost;
					previous[arc.to] = current.node;
					queue.push({ cost, node: arc.to, priority: cost + distanceM(points[arc.to]!, to.point) });
				}
			}
		}
		current = queue.pop();
	}
	return null;
}

/** Pure single-query API: it never retains a location after returning. */
export function findWalkingPath(index: WalkingGraphIndex, input: WalkingPathInput): WalkingPath | null {
	return findPath(index, input);
}

/** Create once per request, never on the static index: locations and failed snaps are request-scoped. */
export function createWalkingSession(index: WalkingGraphIndex): (input: WalkingPathInput) => WalkingPath | null {
	const snaps = new Map<string, Snap | null>();
	return (input) => findPath(index, { ...input, snaps });
}
