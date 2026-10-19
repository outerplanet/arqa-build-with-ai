/* eslint-disable no-await-in-loop -- Requests run sequentially to preserve a readable probe log. */
/* eslint-disable no-console -- This verification CLI reports fixed scenario names and tool status. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { chatResponseSchema } from '../src/server/agent/model/agent.schema';
import { findPlacesResultSchema, walkPlanSchema } from '../src/server/places/model/places.schema';

const cases = [
	{
		id: 'expo',
		query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'nur-alem',
		query: 'Я у Нур Алем, хочу посмотреть музей или необычное место на 1–2 часа пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'mega',
		query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'coffee',
		location: { lat: 51.089, lon: 71.416 },
		query: 'Хочу тихое место с кофе и розеткой недалеко от меня.',
		tools: ['find_places'],
	},
	{
		id: 'child',
		location: { lat: 51.089, lon: 71.416 },
		query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
		tools: ['find_places'],
	},
	{ id: 'flight', query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', tools: [] },
	{
		id: 'night',
		location: { lat: 51.128, lon: 71.43 },
		query: 'Ищу необычную ночную активность на последние пару часов.',
		tools: ['find_places'],
	},
	{
		// Only `wheelchair=yes` qualifies; an honest empty answer is a valid outcome here.
		allowEmpty: true,
		id: 'accessible',
		location: { lat: 51.128, lon: 71.43 },
		query: 'Передвигаюсь на коляске, найди кафе в пределах 10 минут пешком.',
		tools: ['find_places'],
	},
	{
		id: 'route',
		location: { lat: 51.128, lon: 71.43 },
		query: 'Составь маршрут из двух-трёх мест на 90 минут.',
		tools: ['find_places', 'plan_walk'],
	},
	{ id: 'unknown-location', query: 'Хочу погулять рядом со мной.', tools: [] },
];

async function main() {
	const endpoint = new URL('/api/chat', process.argv[2] ?? 'http://127.0.0.1:3000');
	if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) {
		throw new Error('Only a local test server is supported');
	}
	const records = [];
	let failed = false;
	for (const scenario of cases) {
		const location = 'location' in scenario ? scenario.location : undefined;
		const input = {
			messages: [{ content: scenario.query, role: 'user' }],
			...(location === undefined ? {} : { location }),
		};
		const response = await fetch(endpoint, {
			body: JSON.stringify(input),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
			signal: AbortSignal.timeout(120000),
		});
		if (!response.ok) throw new Error('Scenario HTTP failure');
		const result = chatResponseSchema.parse(await response.json());
		const searches = result.toolCalls
			.filter((tool) => tool.name === 'find_places')
			.map((tool) => findPlacesResultSchema.parse(tool.result));
		const plans = result.toolCalls
			.filter((tool) => tool.name === 'plan_walk')
			.map((tool) => walkPlanSchema.parse(tool.result));
		const candidates = [
			...searches.flatMap((search) => search.candidates),
			...plans.flatMap((plan) => plan.stops.map((stop) => stop.candidate)),
		];
		const selected = result.recommendedPlaceIds ?? [];
		const selectionValid =
			selected.length <= 3 &&
			selected.every((id) =>
				candidates.some(
					(candidate) =>
						candidate.place.id === id &&
						result.reply.includes(candidate.place.name) &&
						result.reply.includes(candidate.place.sourceUrl),
				),
			);
		const routeValid =
			scenario.id !== 'route' ||
			plans.some(
				(plan) =>
					plan.stops.length >= 2 &&
					plan.stops.length <= 3 &&
					plan.totalMinutes <= 90 &&
					plan.stops.every((stop) => selected.includes(stop.candidate.place.id)),
			);
		const accessValid =
			scenario.id !== 'accessible' ||
			searches.every((search) => search.candidates.every((candidate) => candidate.place.wheelchair === 'yes'));
		const nightValid =
			scenario.id !== 'night' ||
			selected.every((id) =>
				candidates.some((candidate) => candidate.place.id === id && candidate.open.status === 'open'),
			);
		// A case that expects tools must actually recommend something, not just call them.
		const nonEmpty =
			scenario.tools.length === 0 ||
			('allowEmpty' in scenario && scenario.allowEmpty) ||
			(candidates.length > 0 && selected.length > 0);
		const passed =
			selectionValid &&
			routeValid &&
			accessValid &&
			nightValid &&
			nonEmpty &&
			result.toolCalls.every((tool) => tool.status === 'ok') &&
			scenario.tools.every((name) => result.toolCalls.some((tool) => tool.name === name)) &&
			(scenario.tools.length !== 0 || result.reply.includes('Где вы'));
		failed ||= !passed;
		records.push({
			httpStatus: response.status,
			id: scenario.id,
			input,
			passed,
			query: scenario.query,
			result,
			simulatedBrowserLocation: location !== undefined,
		});
		console.log(`${passed ? 'Пройден' : 'Не пройден'}: ${scenario.id}. Инструментов: ${result.toolCalls.length}.`);
	}
	const target = 'docs/presentation-http-probes.json';
	const temporary = `${target}.tmp`;
	try {
		await writeFile(
			temporary,
			JSON.stringify(
				{
					at: new Date().toISOString(),
					datasetSha256: createHash('sha256')
						.update(await readFile('data/poi.json'))
						.digest('hex'),
					mode: 'http-local-app',
					records,
					simulatedBrowserLocation: true,
					sourceGitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
				},
				null,
				2,
			) + '\n',
		);
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	if (failed) process.exitCode = 1;
}

void main().catch(() => {
	console.error('Проверка сценариев не завершена. Запустите локальное приложение и проверьте его адрес.');
	process.exitCode = 1;
});
