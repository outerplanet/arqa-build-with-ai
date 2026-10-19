/* eslint-disable no-await-in-loop -- The matrix changes process-wide backend settings between scenarios. */
/* eslint-disable no-console -- This CLI reports public synthetic scenario identifiers and outcomes. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { platform, release } from 'node:os';
import { resolve } from 'node:path';
import { type ChatRequest, chatResponseSchema } from '../src/server/agent/model/agent.schema';
import { runAgent } from '../src/server/agent/usecase/agent';
import { recommendedPlaceIdsForTools } from '../src/server/agent/usecase/reply';
import { createCtx } from '../src/server/kernel/ctx';
import { LOCAL_EMBEDDING_MODEL } from '../src/server/kernel/embeddingConfig';
import { lexicalScores } from '../src/server/places/model/lexical';
import {
	type Candidate,
	findPlacesResultSchema,
	resolvedLocationSchema,
	walkPlanSchema,
} from '../src/server/places/model/places.schema';
import { readPlaces } from '../src/server/places/repo/places';
import { readVectors } from '../src/server/places/repo/vectors';
import { recommendationShape } from './qa-contract.mjs';

/** Public synthetic cases, not captured user locations. Domain time is explicitly fixed. */
const scenarioTime = '2026-10-19T16:00:00.000Z';
interface Scenario {
	allowEmpty?: boolean;
	id: string;
	landmark?: false | string;
	location?: { lat: number; lon: number };
	query: string;
	tools: string[];
}
const cases: Scenario[] = [
	{
		id: 'expo',
		landmark: 'osm:way/454857501',
		query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		allowEmpty: true,
		id: 'nur-alem',
		landmark: 'osm:way/454857501',
		query: 'Я у Нур Алем, хочу посмотреть музей или необычное место на 1–2 часа пешком.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'mega',
		landmark: 'osm:way/499328514',
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
	{
		id: 'khan-shatyr',
		landmark: 'osm:way/460703779',
		query: 'Я у Хан Шатыр, хочу прогуляться 30–60 минут.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'bayterek',
		landmark: 'osm:way/230401645',
		query: 'Я у Байтерека, хочу прогуляться 30–60 минут.',
		tools: ['resolve_location', 'find_places'],
	},
	{
		id: 'embankment',
		landmark: false,
		query: 'Я у набережной, хочу прогуляться 30–60 минут.',
		tools: ['resolve_location'],
	},
];

function fingerprint(content: Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function checkHours(candidate: Candidate, reply: string): boolean {
	if (candidate.open.status === 'open' && !candidate.place.openingHours) return false;
	const beforeSource = reply.slice(0, reply.indexOf(candidate.place.sourceUrl));
	const section = beforeSource.slice(beforeSource.lastIndexOf('\n\n') + 2);
	if (candidate.open.status === 'unknown' && !section.includes('часы работы неизвестны')) return false;
	return candidate.open.status === 'open' || !section.includes('Часы: открыто');
}

/** Real dispatcher, real repositories, real ranking and optional local inference; no injected stubs. */
async function execute(scenario: Scenario, backend: 'lexical' | 'local' | 'unavailable-python') {
	process.env.EMBEDDING_PROVIDER = backend === 'lexical' ? 'lexical' : 'local';
	const originalPython = process.env.EMBEDDING_PYTHON;
	if (backend === 'unavailable-python') process.env.EMBEDDING_PYTHON = resolve('.qa-nonexistent-python');
	try {
		const input: ChatRequest = {
			messages: [{ content: scenario.query, role: 'user' }],
			...(scenario.location ? { location: scenario.location } : {}),
		};
		const agentResult = await runAgent(createCtx({ now: new Date(scenarioTime) }), input);
		// Match the Route Handler's production projection, including authoritative map/card selection.
		const result = chatResponseSchema.parse({
			...agentResult,
			recommendedPlaceIds: recommendedPlaceIdsForTools({
				messages: input.messages,
				toolCalls: agentResult.toolCalls,
			}),
		});
		const searches = result.toolCalls
			.filter((tool) => tool.name === 'find_places')
			.map((tool) => findPlacesResultSchema.parse(tool.result));
		const plans = result.toolCalls
			.filter((tool) => tool.name === 'plan_walk')
			.map((tool) => walkPlanSchema.parse(tool.result));
		const resolved = result.toolCalls
			.filter((tool) => tool.name === 'resolve_location')
			.map((tool) => resolvedLocationSchema.parse(tool.result));
		const candidates = [
			...searches.flatMap((search) => search.candidates),
			...plans.flatMap((plan) => plan.stops.map((stop) => stop.candidate)),
		];
		const selectedIds = result.recommendedPlaceIds ?? [];
		const selected = selectedIds.map((id) => candidates.find((candidate) => candidate.place.id === id));
		const originals = new Map(readPlaces().map((place) => [place.id, JSON.stringify(place)]));
		const checks = {
			accessibleConfirmed:
				scenario.id !== 'accessible' || candidates.every((candidate) => candidate.place.wheelchair === 'yes'),
			actualDatasetOnly: candidates.every(
				(candidate) => originals.get(candidate.place.id) === JSON.stringify(candidate.place),
			),
			allToolCallsSucceeded: result.toolCalls.every((tool) => tool.status === 'ok'),
			backendConfirmed: searches.every((search) =>
				backend === 'local' ? search.note === null : search.note?.includes('лексический поиск') === true,
			),
			canonicalLandmark:
				typeof scenario.landmark !== 'string' ||
				resolved.some((location) => location.found && location.matchedPlaceId === scenario.landmark),
			expectedTools: scenario.tools.every((name) => result.toolCalls.some((tool) => tool.name === name)),
			generatedIdeasMarked:
				(result.reply.match(/Что делать:/gu)?.length ?? 0) ===
				(result.reply.match(/Что делать:[^\n]+\(сгенерированная идея\)/gu)?.length ?? 0),
			honestHours: selected.every((candidate) => candidate !== undefined && checkHours(candidate, result.reply)),
			locationClarified:
				scenario.landmark !== false ||
				(selected.length === 0 &&
					!result.toolCalls.some((tool) => tool.name === 'find_places') &&
					resolved.every((location) => !location.found)),
			nightOnlyOpen: scenario.id !== 'night' || selected.every((candidate) => candidate?.open.status === 'open'),
			noLocationNoSearch:
				scenario.tools.length !== 0 ||
				(!result.toolCalls.some((tool) => tool.name === 'find_places') &&
					/Где вы|Уточните|уточните|ориентир/u.test(result.reply)),
			recommendationShape: recommendationShape({
				allowEmpty: scenario.allowEmpty === true || scenario.landmark === false || scenario.tools.length === 0,
				reply: result.reply,
				selectedCount: selectedIds.length,
			}),
			routeBudgetAndStops:
				scenario.id !== 'route' ||
				plans.some(
					(plan) =>
						plan.stops.length >= 2 &&
						plan.stops.length <= 3 &&
						plan.totalMinutes <= 90 &&
						plan.stops.every((stop) => selectedIds.includes(stop.candidate.place.id)),
				),
			selectionAndSources:
				selected.length <= 3 &&
				selected.every(
					(candidate) =>
						candidate !== undefined &&
						result.reply.includes(candidate.place.name) &&
						result.reply.includes(candidate.place.sourceUrl),
				),
		};
		const passed = Object.values(checks).every(Boolean);
		console.log(
			`${passed ? 'PASS' : 'FAIL'} ${backend}/${scenario.id}${
				passed
					? ''
					: `: ${Object.entries(checks)
							.filter(([, value]) => !value)
							.map(([name]) => name)
							.join(', ')}`
			}`,
		);
		return {
			backend,
			checks,
			id: scenario.id,
			input,
			passed,
			result,
			simulatedBrowserLocation: scenario.location !== undefined,
		};
	} finally {
		if (originalPython === undefined) delete process.env.EMBEDDING_PYTHON;
		else process.env.EMBEDDING_PYTHON = originalPython;
	}
}

async function main() {
	process.env.LLM_PROVIDER = 'mock';
	process.env.LLM_API_KEY = '';
	process.env.OPENAI_API_KEY = '';
	process.env.EMBEDDING_MODEL = '';
	const places = readPlaces();
	const vectors = readVectors();
	if (vectors?.model !== LOCAL_EMBEDDING_MODEL || vectors.byId.size !== places.length)
		throw new Error('A complete local vector index is required');
	const synonyms = [
		{ category: 'cafe', query: 'кофе' },
		{ category: 'park', query: 'саябақ' },
	].map(({ category, query }) => {
		const scores = lexicalScores(query, places);
		const matches = places
			.filter((place) => place.category === category && (scores.get(place.id) ?? 0) > 0)
			.map((place) => ({ id: place.id, name: place.name, score: scores.get(place.id) }));
		return { category, matches, passed: matches.length > 0, query };
	});
	const records = [];
	for (const backend of ['local', 'lexical'] as const) {
		for (const scenario of cases) records.push(await execute(scenario, backend));
	}
	records.push(await execute(cases[3]!, 'unavailable-python'));
	const passed = records.every((record) => record.passed) && synonyms.every((record) => record.passed);
	const report = {
		at: new Date().toISOString(),
		credentials: 'No API keys; mock chat; offline cached local model or explicit lexical search.',
		crossPlatformScope:
			'Executed on the recorded platform only; portable CLI and fallback are not evidence of a Windows/Linux execution.',
		datasetSha256: fingerprint(await readFile('data/poi.json')),
		dimensions: vectors.dims,
		mode: 'real-cli-dispatcher',
		model: vectors.model,
		passed,
		placeCount: places.length,
		platform: {
			node: process.version,
			python: execFileSync(process.env.EMBEDDING_PYTHON || 'python3', ['--version'], { encoding: 'utf8' }).trim(),
			release: release(),
			system: platform(),
		},
		records,
		scenarioTime,
		scenarioTimeAstana: '2026-10-19 21:00:00 UTC+05:00',
		sourceGitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
		synonyms,
		vectorCount: vectors.byId.size,
		vectorIndexSha256: fingerprint(await readFile('data/poi.vectors.json')),
	};
	const target = 'docs/qa-search-matrix.json';
	const temporary = `${target}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : 'QA matrix failed');
	process.exitCode = 1;
});
