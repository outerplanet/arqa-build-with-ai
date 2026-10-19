import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareStandalone } from './prepare-standalone.mjs';

/** @param {import('node:test').TestContext} t */
function fixture(t, withStatic = true) {
	const root = mkdtempSync(join(tmpdir(), 'arqa-release-'));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	mkdirSync(join(root, '.next/standalone'), { recursive: true });
	writeFileSync(join(root, '.next/standalone/server.js'), '// fixture');
	writeFileSync(join(root, '.env'), 'fixture-only');
	if (withStatic) {
		mkdirSync(join(root, '.next/static/chunks'), { recursive: true });
		writeFileSync(join(root, '.next/static/chunks/app.js'), '// static');
	}
	return root;
}

await test('removes copied environment files, preserves root environment and copies Unicode public assets', (t) => {
	const root = fixture(t);
	const standalone = join(root, '.next/standalone');
	for (const name of ['.env', '.env.local', '.env.production']) writeFileSync(join(standalone, name), 'fixture-only');
	mkdirSync(join(root, 'public/Астана'), { recursive: true });
	writeFileSync(join(root, 'public/Астана/карта.svg'), '<svg/>');
	prepareStandalone(root);
	for (const name of ['.env', '.env.local', '.env.production'])
		assert.equal(existsSync(join(standalone, name)), false);
	assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'fixture-only');
	assert.equal(readFileSync(join(standalone, '.next/static/chunks/app.js'), 'utf8'), '// static');
	assert.equal(readFileSync(join(standalone, 'public/Астана/карта.svg'), 'utf8'), '<svg/>');
});

await test('supports absent public directory and repeated preparation', (t) => {
	const root = fixture(t);
	prepareStandalone(root);
	prepareStandalone(root);
	assert.equal(existsSync(join(root, '.next/standalone/.next/static/chunks/app.js')), true);
});

await test('rejects incomplete build before modifying environment files', (t) => {
	const root = fixture(t, false);
	const copiedEnvironment = join(root, '.next/standalone/.env');
	writeFileSync(copiedEnvironment, 'fixture-only');
	assert.throws(() => prepareStandalone(root), /сборк/);
	assert.equal(readFileSync(copiedEnvironment, 'utf8'), 'fixture-only');
	assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'fixture-only');
	assert.equal(existsSync(join(root, '.next/standalone/public')), false);
});

await test('requires standalone server even when static assets exist', (t) => {
	const root = fixture(t);
	rmSync(join(root, '.next/standalone/server.js'));
	assert.throws(() => prepareStandalone(root), /сборк/);
	assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'fixture-only');
});
