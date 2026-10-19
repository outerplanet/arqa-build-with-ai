import { type ToolCall } from '@server/agent/model/agent.schema';
import { type Ctx } from '@server/kernel/ctx';
import { isDomainError } from '@server/kernel/errors';
import {
	findPlacesInputSchema,
	getPlaceInputSchema,
	planWalkInputSchema,
	resolveLocationInputSchema,
} from '@server/places/model/places.schema';
import { type PlacesContext } from '@server/places/usecase/context';
import { searchPlaces } from '@server/places/usecase/findPlaces';
import { getPlace } from '@server/places/usecase/getPlace';
import { planWalk } from '@server/places/usecase/planWalk';
import { resolveLocation } from '@server/places/usecase/resolveLocation';
import 'server-only';
import { z } from 'zod';
import { categoriesFor, scenarioFor } from './scenario';

/**
 * The tool registry: one place that knows what the agent can do.
 *
 * Adding a tool is one object. Its JSON Schema is derived from the zod schema rather than written
 * twice, so the validation the handler runs and the contract the model is shown can never drift
 * apart — which is the bug that eats an afternoon, because it looks like the model being stupid.
 *
 * The same registry feeds both adapters and the scripted one. A tool is therefore exercised
 * identically however the demo is being driven.
 */

export interface ToolSpec {
	/** Written for the model: when to reach for this, not what it returns. */
	description: string;
	handler: (ctx: PlacesContext, args: Record<string, unknown>) => unknown;
	/** Written for a human watching the activity panel. Short. */
	label: string;
	name: string;
	parameters: z.ZodType;
}

/**
 * Validation happens inside the handler, so no caller can forget it.
 *
 * Rule 5 of `CLAUDE.md` — validate all external input on the server — applies with force here:
 * tool arguments are a language model's free text, which is about as external as input gets.
 */
function defineTool<S extends z.ZodType>(spec: {
	description: string;
	handler: (ctx: PlacesContext, args: z.output<S>) => unknown;
	label: string;
	name: string;
	parameters: S;
}): ToolSpec {
	return {
		description: spec.description,
		handler: (ctx, args) => spec.handler(ctx, spec.parameters.parse(args)),
		label: spec.label,
		name: spec.name,
		parameters: spec.parameters,
	};
}

export interface CurrentTime {
	iso: string;
	local: string;
	timeZone: string;
}

/** Reads the clock through `ctx`, so a test pins it. An unknown zone throws a RangeError. */
function currentTime(ctx: Ctx, input: { timeZone?: string | undefined }): CurrentTime {
	const timeZone = input.timeZone ?? 'UTC';
	const local = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(ctx.now);

	return { iso: ctx.now.toISOString(), local, timeZone };
}

/**
 * One domain-free tool, so the loop, the dispatcher and the activity panel have something real to
 * run before the product exists. Add the product's tools beside it.
 *
 * A tool that changes stored data also needs a confirmation rule — prompt rule 2 — and a re-check
 * of its own preconditions in the handler. See the agent rules in `AGENTS.md`.
 */
export const TOOLS: readonly ToolSpec[] = [
	defineTool({
		description:
			"Returns the current date and time. Call this whenever an answer depends on today's date or the time of day — never assume it.",
		handler: (ctx, args) => currentTime(ctx, args),
		label: 'Проверка времени',
		name: 'get_current_time',
		parameters: z.object({
			timeZone: z.string().min(1).optional().describe('IANA time zone, for example Asia/Almaty. Defaults to UTC.'),
		}),
	}),
	defineTool({
		description:
			'Определяет локацию из слов пользователя по названиям и ориентирам датасета. В text скопируй ДОСЛОВНО всё сообщение пользователя с ориентиром, ничего не добавляй (в том числе «Астана»), не переводи и не изменяй названия. Вызови перед поиском, если пользователь назвал место. При неоднозначности уточни локацию, не угадывай координаты.',
		handler: (ctx, args) => {
			const result = resolveLocation(ctx, args);

			ctx.resolvedLocation = result;
			return result;
		},
		label: 'Определение локации',
		name: 'resolve_location',
		parameters: resolveLocationInputSchema,
	}),
	defineTool({
		description:
			'Ищет места рядом с локацией браузера или результатом resolve_location. Укажи пожелания, категории и предел ходьбы. Не выдумывай near: это должна быть подтверждённая точка пользователя. Данные о часах, источниках и расстояниях бери только из результата.',
		handler: (ctx, args) => {
			const preferences = scenarioFor(ctx.userMessages?.join('\n') ?? '');
			return searchPlaces(ctx, {
				// Quoted in the filters only: the whole-walk budget is not a per-place radius.
				budgetMinutes: preferences.durationMinutes,
				filters: {
					...args,
					accessibleOnly: preferences.accessibleOnly ?? args.accessibleOnly,
					// This product answers "now"; the model cannot invent a different checking time.
					at: ctx.now.toISOString(),
					// Only categories from the user's interest override the model, never the location phrase.
					categories: categoriesFor(preferences, { purpose: 'search', requested: args.categories }),
					// The schema fills 15 when the model omits it, so a time budget sets the radius unless
					// the user named a walking limit, which nothing may exceed.
					maxWalkMinutes:
						preferences.walkLimitExplicit || preferences.durationMinutes === undefined
							? Math.min(args.maxWalkMinutes, preferences.maxWalkMinutes)
							: preferences.maxWalkMinutes,
					query: preferences.query || args.query,
				},
				preferNotable: preferences.sights,
			});
		},
		label: 'Поиск мест',
		name: 'find_places',
		parameters: findPlacesInputSchema,
	}),
	defineTool({
		description:
			'Возвращает подробности одного места из датасета по OSM id, полученному из поиска. Не придумывай id. Отсутствие часов и описания — неизвестные данные.',
		handler: getPlace,
		label: 'Сведения о месте',
		name: 'get_place',
		parameters: getPlaceInputSchema,
	}),
	defineTool({
		description:
			'Подбирает прогулку до 3 остановок в пределах бюджета времени; может вернуть одну запасную остановку с явной пометкой. start должен совпадать с подтверждённой локацией пользователя. Если локальная пешеходная сеть доступна, учитывает путь по дорожкам и возвращает walkingRoute; иначе явно сообщает, что путь не проверен. Не используй всё время перед вылетом на прогулку: уточни запас на аэропорт.',
		handler: (ctx, args) => {
			const preferences = scenarioFor(ctx.userMessages?.join('\n') ?? '');
			const { stops } = preferences;
			return planWalk(ctx, {
				...args,
				categories: categoriesFor(preferences, { purpose: 'route', requested: args.categories }),
				durationMinutes: Math.min(args.durationMinutes, preferences.durationMinutes ?? args.durationMinutes),
				// The user's own «из трёх мест» decides the stop count, not the model's argument.
				...(stops === undefined
					? {}
					: { maxStops: Math.min(3, Math.max(2, stops.max)), requestedStops: Math.min(3, stops.min) }),
				query: preferences.query || args.query,
			});
		},
		label: 'Планирование прогулки',
		name: 'plan_walk',
		parameters: planWalkInputSchema,
	}),
];

const PUBLIC_ERRORS: Record<string, string> = {
	invalid_place_results: 'Не удалось проверить найденные места по исходным данным. Попробуйте ещё раз.',
	invalid_walk_plan: 'Не удалось составить маршрут в пределах указанного времени.',
	location_mismatch: 'Точка начала не совпала с вашей локацией. Уточните, откуда начать прогулку.',
	location_required: 'Где вы сейчас находитесь? Назовите ориентир или передайте геолокацию.',
	location_unconfirmed: 'Локация должна быть указана в вашем сообщении. Где вы сейчас находитесь?',
	place_not_found: 'Место не найдено в нашем датасете.',
	places_unavailable: 'Данные мест и алгоритмы поиска ещё не подключены. Рекомендации пока недоступны.',
};

/** `$schema` is meaningful to a validator and noise to an inference endpoint. */
function parametersJsonSchema(parameters: z.ZodType): Record<string, unknown> {
	const full = z.toJSONSchema(parameters, { io: 'input' }) as Record<string, unknown>;

	return Object.fromEntries(Object.entries(full).filter(([key]) => key !== '$schema'));
}

/** Chat Completions dialect: NVIDIA NIM, Groq, vLLM, OpenAI. */
export function chatToolDefinitions(): {
	function: { description: string; name: string; parameters: Record<string, unknown> };
	type: 'function';
}[] {
	return TOOLS.map((tool) => ({
		function: {
			description: tool.description,
			name: tool.name,
			parameters: parametersJsonSchema(tool.parameters),
		},
		type: 'function',
	}));
}

/** Responses dialect: the same tools, flattened one level. */
export function responsesToolDefinitions(): {
	description: string;
	name: string;
	parameters: Record<string, unknown>;
	strict: boolean;
	type: 'function';
}[] {
	return TOOLS.map((tool) => ({
		description: tool.description,
		name: tool.name,
		parameters: parametersJsonSchema(tool.parameters),
		// Non-strict on purpose: strict mode requires every property to be required, which forbids
		// the optional arguments that make a tool pleasant to call. Zod validates anyway.
		strict: false,
		type: 'function',
	}));
}

/**
 * Runs one tool and shapes the result for the activity panel.
 *
 * It never throws. A thrown error here would kill the whole turn and the panel would show nothing
 * at all — the one moment somebody is looking straight at it. A tool that fails is a row that says
 * so, which is information; a blank panel is not.
 */
export async function executeTool(
	ctx: PlacesContext,
	input: { args: Record<string, unknown>; name: string },
): Promise<ToolCall> {
	// `performance.now` rather than `ctx.now`: this measures elapsed time, it does not ask what
	// time it is. Business rules still read the clock only through `ctx`.
	const started = performance.now();
	const spec = TOOLS.find((candidate) => candidate.name === input.name);
	const elapsed = () => Math.round(performance.now() - started);

	// A model can hallucinate a tool name that was never offered. Saying so beats crashing.
	if (spec === undefined) {
		return {
			arguments: input.args,
			durationMs: elapsed(),
			label: 'Неизвестный инструмент',
			name: input.name,
			result: `Инструмент ${input.name} не найден.`,
			status: 'error',
		};
	}

	const base = { arguments: input.args, label: spec.label, name: spec.name };

	try {
		const result = await spec.handler(ctx, input.args);

		return { ...base, durationMs: elapsed(), result, status: 'ok' };
	} catch (cause) {
		return {
			...base,
			durationMs: elapsed(),
			result:
				isDomainError(cause) && cause.constraint !== undefined
					? (PUBLIC_ERRORS[cause.constraint] ?? 'Не удалось выполнить запрос.')
					: 'Не удалось выполнить инструмент. Проверьте параметры и попробуйте ещё раз.',
			status: 'error',
		};
	}
}
