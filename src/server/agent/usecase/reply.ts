import { type ChatMessage, type ToolCall } from '@server/agent/model/agent.schema';
import { findPlacesResultSchema, placeSchema, walkPlanSchema } from '@server/places/model/places.schema';
import { type PlacesContext } from '@server/places/usecase/context';
import 'server-only';
import { z } from 'zod';
import { formatRecommendations, formatWalk } from './formatReply';
import { scenarioFor } from './scenario';

/** Recommendation facts are rendered from validated tool results, never free-form model output. */
export function replyForTools(
	ctx: PlacesContext,
	input: { messages: readonly ChatMessage[]; toolCalls: readonly ToolCall[] },
): string {
	const scenario = scenarioFor(
		input.messages
			.filter((message) => message.role === 'user')
			.map((message) => message.content)
			.join('\n'),
	);
	const successful = input.toolCalls.filter((call) => call.status === 'ok');
	const search = successful.findLast((call) => call.name === 'find_places');
	const found = findPlacesResultSchema.safeParse(search?.result);
	const route = walkPlanSchema.safeParse(successful.findLast((call) => call.name === 'plan_walk')?.result);

	if (route.success && found.success && !scenario.flight && !scenario.night) {
		const { origin, usedFilters } = found.data;

		return `Локация: ${origin.label ?? `${origin.point.lat}, ${origin.point.lon}`} (${origin.source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).\nФильтры: ${usedFilters.join('; ')}.\n\n${formatWalk(route.data)}`;
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
