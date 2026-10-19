import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Nothing inside a transaction runs two queries at once.
 *
 * An interactive transaction holds one connection. Two queries issued together on the same
 * `tx` do not run in parallel — they queue — and in this project they queued catastrophically:
 * a suite of sixteen tests took **thirty-eight minutes**, and five and a half seconds once the
 * two `Promise.all` calls were written in order. Nothing errored, nothing warned, and every
 * assertion passed both times.
 *
 * That is the shape of the failure worth guarding against. It is not a wrong answer, it is a
 * page that takes minutes instead of milliseconds, and the only symptom is a stopwatch.
 *
 * The rule is crude on purpose: a file that opens transactions does not also use
 * `Promise.all`. Concurrency against the plain client is fine — each operation gets its own
 * connection — and those files do not import `withTransaction`.
 */

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

function serverFiles(): string[] {
	return readdirSync(SERVER_ROOT, { recursive: true })
		.map((entry) => String(entry).split(sep).join('/'))
		.filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.startsWith('db/generated/'));
}

describe('interactive transactions', () => {
	const files = serverFiles();

	it('finds server modules to check, so an empty sweep cannot pass', () => {
		expect(files.length).toBeGreaterThan(3);
	});

	it('never run two queries at once on one connection', () => {
		const offenders = files.filter((path) => {
			// Comments are stripped first. The rule is about code, and the first version of this
			// check failed on the comment explaining why a usecase had stopped using Promise.all.
			const code = stripComments(readFileSync(join(SERVER_ROOT, path), 'utf8'));

			return code.includes('withTransaction') && code.includes('Promise.all');
		});

		expect(offenders).toEqual([]);
	});
});
