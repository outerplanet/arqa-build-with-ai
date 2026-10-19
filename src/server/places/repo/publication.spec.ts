import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'server-only';
import { afterEach, describe, expect, it } from 'vitest';
import { publishCollection } from './publication';

describe('dataset publication', () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
	});
	async function createDirectory() {
		const path = await mkdtemp(join(tmpdir(), 'astana-publication-'));
		directories.push(path);
		return path;
	}
	it('keeps the previous files when a later temporary write fails', async () => {
		const path = await createDirectory();
		await writeFile(join(path, 'poi.json'), '[{"old":true}]\n');
		await writeFile(join(path, 'collect_summary.json'), '{"old":true}\n');
		await expect(
			publishCollection(
				path,
				Object.fromEntries([
					['poi.json', '[{"new":true}]\n'],
					['missing/collect_summary.json', '{"new":true}\n'],
				]),
			),
		).rejects.toThrow();
		expect(await readFile(join(path, 'poi.json'), 'utf8')).toBe('[{"old":true}]\n');
		expect(await readFile(join(path, 'collect_summary.json'), 'utf8')).toBe('{"old":true}\n');
		expect((await readdir(path)).sort()).toEqual(['collect_summary.json', 'poi.json']);
	});
	it('replaces complete JSON payloads and removes its temporary files', async () => {
		const path = await createDirectory();
		await writeFile(join(path, 'poi.json'), '[{"old":true}]\n');
		const files = { 'collect_summary.json': '{"new":true}\n', 'poi.json': '[{"new":true}]\n' };
		await publishCollection(path, files);
		await Promise.all(
			Object.entries(files).map(async ([name, payload]) => {
				expect(await readFile(join(path, name), 'utf8')).toBe(payload);
			}),
		);
		expect((await readdir(path)).sort()).toEqual(['collect_summary.json', 'poi.json']);
	});
});
