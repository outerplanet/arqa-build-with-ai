import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { type Place } from '../model/places.schema';

const state = vi.hoisted(() => ({
	create: vi.fn(),
	env: {},
}));
vi.mock('dotenv', () => ({
	config: ({ processEnv }: { processEnv: Record<string, string> }) => Object.assign(processEnv, state.env),
}));
vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(),
	rename: vi.fn(),
	unlink: vi.fn(),
	writeFile: vi.fn(),
}));
vi.mock('openai', () => ({
	default: vi.fn(function client() {
		return { embeddings: { create: state.create } };
	}),
}));

function place(index: number): Place {
	return {
		address: null,
		category: 'park',
		description: null,
		descriptionSource: null,
		id: `osm:node/${index + 1}`,
		lat: 51.1,
		lon: 71.4,
		name: `Test park ${index}`,
		nameEn: null,
		openingHours: null,
		phone: null,
		popularity: null,
		sourceUrl: `https://www.openstreetmap.org/node/${index + 1}`,
		tags: [],
		website: null,
		wheelchair: null,
	};
}

function response(size: number) {
	return {
		data: Array.from({ length: size }, (_, index) => ({
			embedding: Array.from({ length: 256 }, (_value, column) => (column === 0 ? (index + 1) / 1000 : 0)),
			index,
		})).reverse(),
		model: 'text-embedding-3-small',
	};
}

let log: MockInstance<(...args: unknown[]) => void>;
let error: MockInstance<(...args: unknown[]) => void>;
const previousExitCode = process.exitCode;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.env = { OPENAI_API_KEY: 'unit-test-key' };
	process.exitCode = undefined;
	log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.mocked(readFile).mockResolvedValue(JSON.stringify([place(0), place(1)]));
	vi.mocked(writeFile).mockResolvedValue(undefined);
	vi.mocked(rename).mockResolvedValue(undefined);
	vi.mocked(unlink).mockResolvedValue(undefined);
	state.create.mockResolvedValue(response(2));
});

afterEach(() => {
	process.exitCode = previousExitCode;
	log.mockRestore();
	error.mockRestore();
});

async function run() {
	await import('../../../../scripts/embed');
	await vi.waitFor(() => {
		expect(log.mock.calls.some((call) => String(call[0]).startsWith('Готово:')) || error.mock.calls.length > 0).toBe(
			true,
		);
	});
}

describe('offline embedding CLI', () => {
	it('maps shuffled response indices to POI ids and uses the official endpoint', async () => {
		await run();
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.openai.com/v1' }));
		expect(state.create).toHaveBeenCalledWith(
			expect.objectContaining({ dimensions: 256, model: 'text-embedding-3-small' }),
		);
		const written = vi.mocked(writeFile).mock.calls[0]?.[1];
		if (typeof written !== 'string') throw new Error('Expected JSON string');
		const output = JSON.parse(written) as { byId: Record<string, number[]> };
		expect(output.byId['osm:node/1']?.[0]).toBe(0.001);
		expect(output.byId['osm:node/2']?.[0]).toBe(0.002);
		expect(rename).toHaveBeenCalledTimes(1);
	});
	it('splits 101 POIs into sequential batches of 100 and one', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(Array.from({ length: 101 }, (_, index) => place(index))));
		state.create.mockImplementation(({ input }: { input: string[] }) => Promise.resolve(response(input.length)));
		await run();
		expect(state.create).toHaveBeenCalledTimes(2);
		expect(state.create.mock.calls.map((call) => (call as [{ input: string[] }])[0].input.length)).toEqual([100, 1]);
		expect(rename).toHaveBeenCalledTimes(1);
	});
	it('refuses missing keys before reading data or contacting a provider', async () => {
		state.env = {};
		await run();
		expect(readFile).not.toHaveBeenCalled();
		expect(state.create).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});
	it.each(['incomplete', 'provider', 'changed-dataset'])('preserves the old target on %s', async (failure) => {
		if (failure === 'incomplete') state.create.mockResolvedValue(response(1));
		if (failure === 'provider') state.create.mockRejectedValue(new Error('unit-test-secret'));
		if (failure === 'changed-dataset') {
			vi.mocked(readFile)
				.mockResolvedValueOnce(JSON.stringify([place(0), place(1)]))
				.mockResolvedValueOnce('changed');
		}
		await run();
		expect(writeFile).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(JSON.stringify(error.mock.calls)).not.toContain('unit-test-secret');
	});
});
