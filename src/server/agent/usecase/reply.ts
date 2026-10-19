import { type ChatMessage, type ToolCall } from '@server/agent/model/agent.schema';
import { findPlacesResultSchema, placeSchema, walkPlanSchema } from '@server/places/model/places.schema';
import { type PlacesContext } from '@server/places/usecase/context';
import 'server-only';
import { z } from 'zod';
import { formatRecommendations, formatWalk, selectRecommendations } from './formatReply';
import { scenarioFor } from './scenario';

interface ReplyInput {
	messages: readonly ChatMessage[];
	toolCalls: readonly ToolCall[];
}

function selectedResults(input: ReplyInput) {
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
	const route = walkPlanSchema.safeParse(routeIndex > searchIndex ? successful[routeIndex]?.result : undefined);
	return { found, route, scenario, successful };
}

/** The browser and text renderer share one authoritative recommendation selection. */
export function recommendedPlaceIdsForTools(input: ReplyInput): string[] {
	const { found, route, scenario } = selectedResults(input);
	if (route.success && !scenario.flight && !scenario.night)
		return route.data.stops.map((stop) => stop.candidate.place.id);
	return found.success ? selectRecommendations(found.data, scenario).map((candidate) => candidate.place.id) : [];
}

/** Recommendation facts are rendered from validated tool results, never free-form model output. */
export function replyForTools(ctx: PlacesContext, input: ReplyInput): string {
	const { found, route, scenario, successful } = selectedResults(input);

	if (route.success && !scenario.flight && !scenario.night) {
		const origin = found.success ? found.data.origin : null;
		const point = origin?.point ?? ctx.browserLocation ?? ctx.resolvedLocation?.point ?? route.data.legs[0]?.from;
		const label =
			origin?.label ??
			ctx.resolvedLocation?.label ??
			(point ? `${point.lat}, ${point.lon}` : 'старт из результата инструмента');
		const source = origin?.source ?? (ctx.browserLocation ? 'browser' : 'text');
		return `Локация: ${label} (${source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).\nФильтры: ${found.success ? found.data.usedFilters.join('; ') : scenario.query}.\n\n${formatWalk(route.data)}`;
	}
	if (found.success) return formatRecommendations(found.data, scenario);
	const place = placeSchema.safeParse(successful.findLast((call) => call.name === 'get_place')?.result);

	if (place.success) {
		return `${place.data.name}\nИсточник: OpenStreetMap — ${place.data.sourceUrl}.\n${place.data.description ?? 'Описание отсутствует.'}${place.data.descriptionSource === 'generated' ? ' (сгенерированная идея)' : place.data.descriptionSource === 'wikidata' ? ' (Wikidata)' : ''}\nСтатус «открыто сейчас» не проверен — уточните часы перед выходом.`;
	}
	const failure = input.toolCalls.findLast((call) => call.status === 'error');

	if (failure !== undefined)
		return typeof failure.result === 'string' ? failure.result : 'Не удалось выполнить запрос.';
	const clock = z
		.object({ local: z.string(), timeZone: z.string() })
		.safeParse(successful.findLast((call) => call.name === 'get_current_time')?.result);

	if (clock.success) return `По серверным часам: ${clock.data.local} (${clock.data.timeZone}).`;
	return ctx.browserLocation === undefined && ctx.resolvedLocation?.found !== true
		? `Где вы сейчас находитесь? Назовите ориентир или передайте геолокацию.${scenario.flight ? ' Уточните также, сколько времени осталось с учётом дороги в аэропорт, регистрации и досмотра.' : ''}`
		: 'Какие места вам интересны и сколько времени есть на прогулку?';
}
