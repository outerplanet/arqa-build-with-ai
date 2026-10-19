import { type ToolCall } from '@server/agent/model/agent.schema';
import {
	findPlacesResultSchema,
	placeSchema,
	resolvedLocationSchema,
	walkPlanSchema,
} from '@server/places/model/places.schema';
import { walkingRouteSchema } from '@server/places/model/walkingRoute.schema';
import { z } from 'zod';
import { places, stops } from './reply';

const currentTimeSchema = z.object({ local: z.string().min(1), timeZone: z.string().min(1) });

/**
 * One line of Russian for the activity panel: what this tool call actually returned, read from its
 * validated result. A result that does not parse gets a neutral line, never a guessed one.
 *
 * `shownIds` are the places the answer actually shows, so a search can say «найдено N, показано K».
 */
export function summariseToolCall(call: ToolCall, shownIds: readonly string[] = []): string {
	const { result } = call;
	if (call.status !== 'ok') return typeof result === 'string' && result !== '' ? result : 'Инструмент вернул ошибку.';

	switch (call.name) {
		case 'find_places': {
			const parsed = findPlacesResultSchema.safeParse(result);
			if (!parsed.success) break;
			const { candidates, note } = parsed.data;
			if (candidates.length === 0) return 'Подходящих мест не найдено';
			const shown = candidates.filter((candidate) => shownIds.includes(candidate.place.id)).length;
			const lexical = note?.toLocaleLowerCase('ru').includes('лексическ') === true;
			return `Найдено ${String(candidates.length)} ${places(candidates.length)}, показано ${String(shown)}${lexical ? ' · лексический поиск, без эмбеддингов' : ''}`;
		}
		case 'get_current_time': {
			const parsed = currentTimeSchema.safeParse(result);
			if (parsed.success) return `Сейчас: ${parsed.data.local} (${parsed.data.timeZone})`;
			break;
		}
		case 'get_place': {
			const parsed = placeSchema.safeParse(result);
			if (parsed.success) return parsed.data.name;
			break;
		}
		case 'plan_walk': {
			const parsed = walkPlanSchema.safeParse(result);
			if (!parsed.success) break;
			const route = walkingRouteSchema.safeParse(
				typeof result === 'object' && result !== null && 'walkingRoute' in result ? result.walkingRoute : null,
			);
			const count = parsed.data.stops.length;
			if (count === 0) return 'Маршрут не сложился в заданное время';
			const minutes =
				route.success && route.data.status === 'available' ? route.data.totalMinutes : parsed.data.totalMinutes;
			return `Маршрут: ${String(count)} ${stops(count)}, ≈ ${String(Math.ceil(minutes))} мин`;
		}
		case 'resolve_location': {
			const parsed = resolvedLocationSchema.safeParse(result);
			if (!parsed.success) break;
			const { confidence, found, label } = parsed.data;
			if (!found) return 'Ориентир не найден';
			return `Точка: ${label ?? 'координаты из датасета'}${confidence === 'low' ? ' (неточное совпадение)' : ''}`;
		}
		default:
			break;
	}
	if (typeof result === 'string' && result !== '') return result;
	return 'Ответ получен — подробности ниже';
}
