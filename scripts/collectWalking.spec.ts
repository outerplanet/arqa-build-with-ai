import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWalkingGraph } from './collectWalking';

const nodes = [1, 2, 3, 4].map((id) => ({ id, lat: 51.1 + id / 10000, lon: 71.4, type: 'node' }));
const way = (tags: Record<string, string>, ids = [1, 2, 3]) => ({
	id: 42,
	nodes: ids,
	tags: { highway: 'footway', ...tags },
	type: 'way',
});
const graph = (elements: unknown[]) =>
	buildWalkingGraph({ elements, osm3s: { timestamp_osm_base: '2026-10-19T12:00:00Z' } }, '2026-10-19T12:00:00Z');

void test('preserves every geometry vertex and emits directed provenance edges', () => {
	const result = graph([...nodes, way({})]);
	assert.deepEqual(
		result.nodes.map((node) => node[0]),
		[1, 2, 3],
	);
	assert.deepEqual(result.edges, [
		[0, 1, 42],
		[1, 0, 42],
		[1, 2, 42],
		[2, 1, 42],
	]);
});

void test('rejects restricted ways, unknown access, indoor and unsupported conditional access', () => {
	for (const tags of [
		{ access: 'private' },
		{ foot: 'no' },
		{ access: 'customers' },
		{ access: 'unknown' },
		{ highway: 'motorway' },
		{ motorroad: 'yes' },
		{ indoor: 'yes' },
		{ 'foot:conditional': 'yes @ (Mo-Fr)' },
	]) {
		assert.throws(() => graph([...nodes, way(tags)]), /empty/i);
	}
});

void test('does not bridge blocked or missing geometry nodes', () => {
	assert.throws(() => graph([...nodes.filter((node) => node.id !== 2), way({})]), /empty/i);
	assert.throws(
		() => graph([...nodes.filter((node) => node.id !== 2), { ...nodes[1], tags: { barrier: 'gate' } }, way({})]),
		/empty/i,
	);
	assert.throws(
		() => graph([...nodes.filter((node) => node.id !== 2), { ...nodes[1], tags: { foot: 'private' } }, way({})]),
		/empty/i,
	);
});

void test('honours foot direction and ignores automobile oneway', () => {
	assert.equal(graph([...nodes, way({ oneway: 'yes' })]).edges.length, 4);
	assert.deepEqual(graph([...nodes, way({ 'oneway:foot': '-1' })]).edges, [
		[1, 0, 42],
		[2, 1, 42],
	]);
	assert.deepEqual(graph([...nodes, way({ 'oneway:foot': 'yes' })]).edges, [
		[0, 1, 42],
		[1, 2, 42],
	]);
	assert.throws(() => graph([...nodes, way({ 'oneway:foot': 'reversible' })]), /empty/i);
});

void test('does not invent connections for crossing lines or merge separate levels', () => {
	const result = graph([
		...nodes,
		way({ bridge: 'yes', layer: '1' }, [1, 2]),
		{ ...way({ layer: '0' }, [3, 4]), id: 43 },
	]);
	assert.deepEqual(result.edges, [
		[0, 1, 42],
		[1, 0, 42],
		[2, 3, 43],
		[3, 2, 43],
	]);
});
