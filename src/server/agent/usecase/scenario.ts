import { type Category } from '@server/places/model/places.schema';
import 'server-only';

export interface Scenario {
	accessibleOnly?: boolean;
	categories?: Category[];
	durationMinutes?: number;
	flight: boolean;
	maxWalkMinutes: number;
	night: boolean;
	query: string;
	route: boolean;
}

function durationFrom(text: string): number | undefined {
	if (/полтора\s*час/u.test(text)) return 90;
	if (/пар[ауые]\s*час/u.test(text)) return 120;
	const match = /(?:^|[^\d])(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(час[а-я]*|ч\b|мин[а-я]*)(?!\s*пешком)/u.exec(text);
	if (!match) return undefined;
	const value = Number(match[2] ?? match[1]) * (match[3]!.startsWith('ч') ? 60 : 1);
	return value > 0 ? Math.min(240, value) : undefined;
}

/** Parse preferences only: facilities and flight transport times are never inferred. */
export function scenarioFor(text: string): Scenario {
	const query = text.trim();
	const lower = query.toLowerCase().replaceAll('ё', 'е');
	const flight = /вылет|рейс|самолет|аэропорт/u.test(lower);
	const night = /ноч[а-я]*|ночью/u.test(lower);
	const route = /маршрут|составь.*прогул|построй.*прогул|пройти.*(?:все|эт[иом])|(?:соедини|объедини).*мест/u.test(
		lower,
	);
	const accessibleOnly = /коляск|безбарьер|доступн[а-я]*\s+(?:сред|для.*инвалид)/u.test(lower) || undefined;
	let categories: Category[] | undefined;
	if (/ребен|детск|площадк|интерактив/u.test(lower)) categories = ['playground', 'museum', 'zoo'];
	else if (/кофе|кафе|кофейн|розетк|библиотек/u.test(lower)) categories = ['cafe', 'library'];
	else if (/прогул|парк|набережн|свеж[а-я]*\s+воздух/u.test(lower))
		categories = ['park', 'garden', 'viewpoint', 'artwork'];
	else if (/музе|галере|выставк/u.test(lower)) categories = ['museum', 'gallery'];
	else if (/достопримеч|турист|необыч|экспо|expo/u.test(lower))
		categories = ['attraction', 'museum', 'viewpoint', 'artwork', 'monument'];
	else if (/поесть|ресторан|обед|ужин/u.test(lower)) categories = ['restaurant', 'cafe', 'fast_food'];
	const walking = /(?:до|в пределах|не больше|не более)\s*(\d{1,2})\s*мин[а-я]*\s*(?:пешком|ходьбы)/u.exec(lower);
	const maxWalkMinutes = walking ? Math.min(90, Math.max(5, Number(walking[1]))) : 15;
	// Walking proximity is not a total time budget, even when it is the first number in a request.
	const budgetText = lower.replace(/\d{1,2}\s*мин[а-я]*\s*(?:пешком|ходьбы)/gu, '');
	const durationMinutes = durationFrom(budgetText);
	return { accessibleOnly, categories, durationMinutes, flight, maxWalkMinutes, night, query, route };
}
