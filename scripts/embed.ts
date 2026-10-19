/* eslint-disable no-await-in-loop -- Batches are sequential to respect provider rate limits. */
/* eslint-disable no-console -- The offline CLI reports only safe progress and fixed error messages. */
import { config as loadEnv } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { z } from 'zod';
import { placeSchema } from '../src/server/places/model/places.schema';
import { embeddingSchema, vectorsSchema } from '../src/server/places/repo/vectors';

async function main() {
	// Deliberately read a local .env only: never inherit a third-party endpoint or its key.
	const localEnv: Record<string, string> = {};
	loadEnv({ path: '.env', processEnv: localEnv, quiet: true });
	const apiKey = localEnv.LLM_API_KEY?.trim();
	if (!apiKey) {
		console.error('Эмбеддинги не созданы: добавьте LLM_API_KEY (ключ OpenAI) в локальный .env. Файлы не изменены.');
		process.exitCode = 1;
		return;
	}
	if (localEnv.LLM_BASE_URL?.trim()) {
		console.error(
			'Эмбеддинги не созданы: LLM_API_KEY настроен для другого сервиса (задан LLM_BASE_URL). Нужен прямой ключ OpenAI.',
		);
		process.exitCode = 1;
		return;
	}

	const datasetPath = resolve('data/poi.json');
	const raw = await readFile(datasetPath, 'utf8');
	const datasetSha256 = createHash('sha256').update(raw).digest('hex');
	const places = z
		.array(placeSchema)
		.min(1)
		.parse(JSON.parse(raw) as unknown);
	if (new Set(places.map((place) => place.id)).size !== places.length) throw new Error('Duplicate ids');
	// Explicit official endpoint: OPENAI_BASE_URL and LLM_BASE_URL cannot redirect this key.
	const client = new OpenAI({
		apiKey,
		baseURL: 'https://api.openai.com/v1',
		maxRetries: 2,
		timeout: 60000,
	});
	const byId: Record<string, number[]> = {};
	const batchSchema = z.object({
		data: z.array(z.object({ embedding: embeddingSchema, index: z.number().int().nonnegative() })),
		model: z.literal('text-embedding-3-small'),
	});

	for (let start = 0; start < places.length; start += 100) {
		const batch = places.slice(start, start + 100);
		const input = batch.map((place) =>
			[place.name, place.category, place.tags.join(', '), place.description ?? ''].join(' · '),
		);
		const response = batchSchema.parse(
			await client.embeddings.create({
				dimensions: 256,
				encoding_format: 'float',
				input,
				model: 'text-embedding-3-small',
			}),
		);
		if (response.data.length !== batch.length) throw new Error('Incomplete batch');
		const seen = new Set<number>();
		for (const item of response.data) {
			const place = batch[item.index];
			if (place === undefined || seen.has(item.index)) throw new Error('Invalid embedding index');
			seen.add(item.index);
			// Validate after rounding too: underflow must not persist an all-zero vector.
			byId[place.id] = embeddingSchema.parse(item.embedding.map((value) => Math.round(value * 10000) / 10000));
		}
		console.log(`Обработано мест: ${Math.min(start + 100, places.length)} из ${places.length}.`);
	}
	const output = vectorsSchema.parse({ byId, datasetSha256, dims: 256, model: 'text-embedding-3-small' });
	// Refuse a file assembled while a concurrent collector replaced the dataset.
	if (
		createHash('sha256')
			.update(await readFile(datasetPath))
			.digest('hex') !== datasetSha256
	) {
		throw new Error('Dataset changed');
	}
	const target = resolve('data/poi.vectors.json');
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(output) + '\n', { flag: 'wx' });
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	console.log(`Готово: ${places.length} векторов, 256 измерений. Перезапустите приложение для загрузки файла.`);
}

void main().catch(() => {
	// Provider exceptions may contain secrets and must never be printed or written to artifacts.
	console.error(
		'Эмбеддинги не созданы: ошибка чтения данных, запроса OpenAI или проверки ответа. Итоговый файл не изменён.',
	);
	process.exitCode = 1;
});
