/* eslint-disable no-await-in-loop -- Stage every file before replacing the public snapshot. */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'server-only';

/** Each rename is atomic, but publishing multiple files is not a filesystem transaction. */
export async function publishCollection(directory: string, files: Readonly<Record<string, string>>): Promise<void> {
	await mkdir(directory, { recursive: true });
	const staged: { target: string; temporary: string }[] = [];
	try {
		for (const [name, payload] of Object.entries(files)) {
			const target = join(directory, name);
			const temporary = `${target}.${randomUUID()}.tmp`;
			staged.push({ target, temporary });
			await writeFile(temporary, payload, { flag: 'wx' });
		}
		for (const { target, temporary } of staged) await rename(temporary, target);
	} finally {
		await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })));
	}
}
