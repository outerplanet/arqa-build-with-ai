import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prepare only generated output; credentials and Python/model installations stay outside it. */
export function prepareStandalone(root = process.cwd()) {
	const standalone = join(root, '.next/standalone');
	const server = join(standalone, 'server.js');
	const staticAssets = join(root, '.next/static');
	if (
		!existsSync(server) ||
		!statSync(server).isFile() ||
		!existsSync(staticAssets) ||
		!statSync(staticAssets).isDirectory()
	) {
		throw new Error('Не найдена полная standalone-сборка. Сначала выполните pnpm build.');
	}

	// Next can copy local credentials into standalone output. Never read their contents.
	for (const entry of readdirSync(standalone, { withFileTypes: true })) {
		if ((entry.name === '.env' || entry.name.startsWith('.env.')) && (entry.isFile() || entry.isSymbolicLink())) {
			rmSync(join(standalone, entry.name));
		}
	}
	cpSync(staticAssets, join(standalone, '.next/static'), { recursive: true });
	const publicAssets = join(root, 'public');
	if (existsSync(publicAssets)) cpSync(publicAssets, join(standalone, 'public'), { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		prepareStandalone();
		process.stdout.write('Standalone-сборка подготовлена: ресурсы скопированы, файлы окружения удалены.\n');
	} catch {
		process.stderr.write('Не удалось подготовить standalone-сборку. Проверьте pnpm build и права на файлы.\n');
		process.exitCode = 1;
	}
}
