import { type ChatMessage, type ChatResponse, type ToolCall } from '@server/agent/model/agent.schema';
import {
	categorySchema,
	findPlacesResultSchema,
	placeSchema,
	resolvedLocationSchema,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import { walkingRouteSchema } from '@server/places/model/walkingRoute.schema';
import { type PlacesContext } from '@server/places/usecase/context';
import 'server-only';
import { z } from 'zod';
import {
	type Recommendation,
	renderRecommendations,
	renderWalk,
	type ReplyOptions,
	routeFiltersLine,
} from './formatReply';
import { categoriesFor, scenarioFor } from './scenario';

interface ReplyInput {
	messages: readonly ChatMessage[];
	toolCalls: readonly ToolCall[];
}

/** What every response path returns beside its tool calls. */
export type Answer = Pick<ChatResponse, 'recommendations' | 'recommendedPlaceIds' | 'reply'>;

function selectedResults(input: ReplyInput, now?: Date) {
	const scenario = scenarioFor(
		input.messages
			.filter((message) => message.role === 'user')
			.map((message) => message.content)
			.join('\n'),
	);
	const successful = input.toolCalls.filter((call) => call.status === 'ok');
	const searchIndex = successful.findLastIndex((call) => call.name === 'find_places');
	const routeIndex = successful.findLastIndex((call) => call.name === 'plan_walk');
	const found = findPlacesResultSchema.safeParse(successful[searchIndex]?.result);
	const routeCall = routeIndex > searchIndex ? successful[routeIndex] : undefined;
	const route = walkPlanSchema.safeParse(routeCall?.result);
	const walking = z.object({ walkingRoute: walkingRouteSchema }).safeParse(routeCall?.result);
	const requested = z.array(categorySchema).safeParse(routeCall?.arguments.categories);
	const excludeIds = successful
		.filter((call) => call.name === 'resolve_location')
		.map((call) => resolvedLocationSchema.safeParse(call.result))
		.flatMap((parsed) => (parsed.success && parsed.data.matchedPlaceId ? [parsed.data.matchedPlaceId] : []));
	const options: ReplyOptions = { ...scenario, excludeIds, now };
	// The same rule the plan_walk handler applied, so the filters line names what was searched.
	const routeOptions: ReplyOptions = {
		...options,
		categories: categoriesFor(scenario, {
			purpose: 'route',
			requested: requested.success ? requested.data : undefined,
		}),
		walkingNote: walking.success ? walking.data.walkingRoute.note : undefined,
	};
	const isRoute = route.success && !scenario.flight && !scenario.night;
	return { found, isRoute, options, route, routeOptions, scenario, successful };
}

/**
 * The one place that turns tool results into recommendations. The text and the cards both come
 * out of the same render call, so they cannot name different places or say different things.
 */
function rendered(input: ReplyInput, now?: Date) {
	const selected = selectedResults(input, now);
	const { found, isRoute, options, route, routeOptions } = selected;
	if (isRoute && route.success) return { ...selected, render: renderWalk(route.data, routeOptions) };
	if (found.success) return { ...selected, render: renderRecommendations(found.data, options) };
	return { ...selected, render: null };
}

/** No recommendation to render: a place lookup, a tool error, the clock, or a question back. */
function fallbackReply(
	ctx: PlacesContext,
	{ flight, successful, toolCalls }: ReplyInput & { flight: boolean; successful: readonly ToolCall[] },
): string {
	const place = placeSchema.safeParse(successful.findLast((call) => call.name === 'get_place')?.result);

	if (place.success) {
		return `${place.data.name}\nИсточник: OpenStreetMap — ${place.data.sourceUrl}.\n${place.data.description ?? 'Описание отсутствует.'}${place.data.descriptionSource === 'generated' ? ' (сгенерированная идея)' : place.data.descriptionSource === 'wikidata' ? ' (Wikidata)' : ''}\nСтатус «открыто сейчас» не проверен — уточните часы перед выходом.`;
	}
	const failure = toolCalls.findLast((call) => call.status === 'error');

	if (failure !== undefined)
		return typeof failure.result === 'string' ? failure.result : 'Не удалось выполнить запрос.';
	const clock = z
		.object({ local: z.string(), timeZone: z.string() })
		.safeParse(successful.findLast((call) => call.name === 'get_current_time')?.result);

	if (clock.success) return `По серверным часам: ${clock.data.local} (${clock.data.timeZone}).`;
	if (ctx.browserLocation === undefined && ctx.resolvedLocation?.found === false)
		return 'Не удалось однозначно определить ориентир. Уточните название здания или музея либо передайте геолокацию.';
	return ctx.browserLocation === undefined && ctx.resolvedLocation?.found !== true
		? `Где вы сейчас находитесь? Назовите ориентир или передайте геолокацию.${flight ? ' Уточните также, сколько времени осталось с учётом дороги в аэропорт, регистрации и досмотра.' : ''}`
		: 'Какие места вам интересны и сколько времени есть на прогулку?';
}

const idsOf = (recommendations: readonly Recommendation[]) => recommendations.map((item) => item.placeId);

/** The browser and text renderer share one authoritative recommendation selection. */
export function recommendedPlaceIdsForTools(input: ReplyInput): string[] {
	return idsOf(rendered(input).render?.recommendations ?? []);
}

/** Recommendation facts are rendered from validated tool results, never free-form model output. */
export function answerForTools(ctx: PlacesContext, input: ReplyInput): Answer {
	const { found, isRoute, render, route, routeOptions, scenario, successful } = rendered(input, ctx.now);

	if (render !== null) {
		const { recommendations } = render;
		let reply = render.text;
		if (isRoute) {
			const origin = found.success ? found.data.origin : null;
			const point =
				origin?.point ??
				ctx.browserLocation ??
				ctx.resolvedLocation?.point ??
				(route.success ? route.data.legs[0]?.from : undefined);
			const label =
				origin?.label ??
				ctx.resolvedLocation?.label ??
				(point ? `${point.lat}, ${point.lon}` : 'старт из результата инструмента');
			const source = origin?.source ?? (ctx.browserLocation ? 'browser' : 'text');
			reply = `Локация: ${label} (${source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).\n${routeFiltersLine(routeOptions)}\n\n${render.text}`;
		}
		return {
			recommendations: recommendations.length ? recommendations : undefined,
			recommendedPlaceIds: idsOf(recommendations),
			reply,
		};
	}
	return { recommendedPlaceIds: [], reply: fallbackReply(ctx, { ...input, flight: scenario.flight, successful }) };
}

/** Text only, for callers that predate the structured answer. */
export function replyForTools(ctx: PlacesContext, input: ReplyInput): string {
	return answerForTools(ctx, input).reply;
}
