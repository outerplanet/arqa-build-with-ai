/* eslint-disable no-await-in-loop -- Requests run sequentially to preserve a readable probe log and honest timings. */
/* eslint-disable no-console -- This verification CLI reports fixed scenario names and tool status. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { chatResponseSchema } from '../src/server/agent/model/agent.schema';
import { findPlacesResultSchema, walkPlanSchema } from '../src/server/places/model/places.schema';
import { recommendationShape } from './qa-contract.mjs';

/**
 * Usage: `pnpm scenarios <base-url> [mock|live]`. The label names the server's LLM_PROVIDER; it is
 * recorded, not enforced. Each label's run replaces only its own entry in the probe file.
 */
interface Case {
	/** An honest empty answer is a valid outcome. */
	allowEmpty?: boolean;
	id: string;
	/** Simulated browser geolocation; absent means the location comes from the user's words or nowhere. */
	location?: { lat: number; lon: number };
	query: string;
	/** A planned walk must have this many stops and fit this budget. */
	route?: { maxMinutes: number; maxStops: number; minStops: number };
	tools: string[];
}

const NEAR_BAITEREK = { lat: 51.128, lon: 71.43 };
const LEFT_BANK_HOMES = { lat: 51.089, lon: 71.416 };

const cases: Case[] = [
	{
		// The organisers' own example, verbatim.
		id: 'expo',
		query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'mega',
		query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут — что посоветуете?',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'coffee',
		location: LEFT_BANK_HOMES,
		query: 'Хочу тихое место с кофе и розеткой недалеко от меня.',
		tools: ['find_places'],
	},
	{
		id: 'child',
		location: LEFT_BANK_HOMES,
		query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
		tools: ['find_places'],
	},
	{
		// No location at all: the agent must ask, not guess.
		id: 'flight',
		query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
		tools: [],
	},
	{
		id: 'flight-located',
		location: NEAR_BAITEREK,
		query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
		tools: ['find_places'],
	},
	{
		id: 'night',
		location: NEAR_BAITEREK,
		query: 'Ищу необычную ночную активность (последние пару часов).',
		tools: ['find_places'],
	},
	{
		id: 'baiterek-route',
		query: 'Я у Байтерека, составь маршрут из трёх мест на 90 минут.',
		route: { maxMinutes: 90, maxStops: 3, minStops: 3 },
		// The planner searches on its own; a separate find_places call first is the model's choice.
		tools: ['resolve_location', 'plan_walk'],
	},
	{
		// Only `wheelchair=yes` qualifies; an honest empty answer is a valid outcome here.
		allowEmpty: true,
		id: 'accessible',
		location: NEAR_BAITEREK,
		query: 'Передвигаюсь на коляске, найди кафе в пределах 10 минут пешком.',
		tools: ['find_places'],
	},
	{
		// The origin is excluded; no other museums or galleries may remain nearby.
		allowEmpty: true,
		id: 'nur-alem',
		query: 'Я у Нур Алем, хочу посмотреть музей или необычное место на 1–2 часа пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		// The south-west edge of the dataset box: nothing within five minutes, and the answer must say so.
		allowEmpty: true,
		id: 'empty',
		location: { lat: 51.04, lon: 71.27 },
		query: 'Хочу кофе в пределах 5 минут пешком.',
		tools: ['find_places'],
	},
	{ id: 'unknown-location', query: 'Хочу погулять рядом со мной.', tools: [] },
];

async function main() {
	const endpoint = new URL('/api/chat', process.argv[2] ?? 'http://127.0.0.1:3000');
	const label = process.argv[3] ?? 'mock';
	if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) {
		throw new Error('Only a local test server is supported');
	}
	if (!/^[a-z-]{1,16}$/u.test(label)) throw new Error('Run label must be a short lowercase word');
	const records = [];
	let failed = false;
	for (const scenario of cases) {
		const { location } = scenario;
		const input = {
			messages: [{ content: scenario.query, role: 'user' }],
			...(location === undefined ? {} : { location }),
		};
		const started = performance.now();
		const response = await fetch(endpoint, {
			body: JSON.stringify(input),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
			signal: AbortSignal.timeout(120000),
		});
		if (!response.ok) throw new Error('Scenario HTTP failure');
		const result = chatResponseSchema.parse(await response.json());
		const elapsedMs = Math.round(performance.now() - started);
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
		const { route } = scenario;
		const routeValid =
			route === undefined ||
			plans.some(
				(plan) =>
					plan.stops.length >= route.minStops &&
					plan.stops.length <= route.maxStops &&
					plan.totalMinutes <= route.maxMinutes &&
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
		const allowEmpty = scenario.tools.length === 0 || scenario.allowEmpty === true;
		// A case that expects tools must actually recommend something, not just call them.
		const nonEmpty = allowEmpty || (candidates.length > 0 && selected.length > 0);
		const passed =
			recommendationShape({ allowEmpty, reply: result.reply, selectedCount: selected.length }) &&
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
			elapsedMs,
			httpStatus: response.status,
			id: scenario.id,
			input,
			passed,
			query: scenario.query,
			result,
			simulatedBrowserLocation: location !== undefined,
		});
		console.log(
			`${passed ? 'Пройден' : 'Не пройден'}: ${scenario.id}. Инструментов: ${result.toolCalls.length}. ${elapsedMs} мс.`,
		);
	}
	const target = 'docs/presentation-http-probes.json';
	const temporary = `${target}.tmp`;
	const previous = await readFile(target, 'utf8')
		.then((text) => JSON.parse(text) as { runs?: Record<string, unknown> })
		.catch(() => ({ runs: {} }));
	const run = {
		at: new Date().toISOString(),
		datasetSha256: createHash('sha256')
			.update(await readFile('data/poi.json'))
			.digest('hex'),
		label,
		mode: 'http-local-app',
		records,
		sourceGitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
		timeZoneNote: 'Server wall-clock time; opening hours are evaluated in Asia/Almaty.',
	};
	try {
		await writeFile(temporary, JSON.stringify({ runs: { ...previous.runs, [label]: run } }, null, 2) + '\n');
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
