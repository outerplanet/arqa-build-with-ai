import {
	type Candidate,
	type Category,
	type FindPlacesResult,
	type WalkPlan,
} from '@server/places/model/places.schema';
import 'server-only';

const categoryNames: Record<Category, string> = {
	artwork: 'арт-объект',
	attraction: 'достопримечательность',
	bar: 'бар',
	cafe: 'кафе',
	cinema: 'кинотеатр',
	fast_food: 'место быстрого питания',
	gallery: 'галерея',
	garden: 'сад',
	library: 'библиотека',
	mall: 'торговый центр',
	monument: 'памятник',
	museum: 'музей',
	nightclub: 'ночной клуб',
	other: 'место из набора данных',
	park: 'парк',
	place_of_worship: 'религиозный объект',
	playground: 'детская площадка',
	restaurant: 'ресторан',
	sports: 'спортивный объект',
	theatre: 'театр',
	theme_park: 'парк развлечений',
	viewpoint: 'смотровая площадка',
	zoo: 'зоопарк',
};

function hours(candidate: Candidate): string {
	const { open } = candidate;
	let status = 'часы работы неизвестны — уточните перед выходом';
	if (open.status === 'open') status = `открыто по данным источника${open.until ? ` до ${open.until}` : ''}`;
	if (open.status === 'closed')
		status = `закрыто${open.opensAt ? `; открытие по данным источника в ${open.opensAt}` : ''}`;
	return `${status}${open.confidence === 'low' ? '; уверенность низкая' : ''}${open.note ? `. ${open.note}` : ''}`;
}

function placeDetails(candidate: Candidate): string {
	const { place } = candidate;
	const descriptionSource =
		place.descriptionSource === 'generated'
			? 'сгенерированная идея'
			: place.descriptionSource === 'wikidata'
				? 'Wikidata'
				: place.descriptionSource === 'osm'
					? 'OpenStreetMap'
					: 'источник описания не указан';
	return [
		`Почему: ${categoryNames[place.category]} в ${Math.round(candidate.distanceM)} м от отправной точки.`,
		`На посещение: ${candidate.visitMinutes} мин (оценка).`,
		place.description ? `${place.description} (${descriptionSource}).` : '',
		'Что делать: познакомиться с местом и осмотреться (сгенерированная идея).',
		`Часы: ${hours(candidate)}.`,
		`Источник места: [OpenStreetMap](${place.sourceUrl}).`,
	]
		.filter(Boolean)
		.join('\n');
}

export function formatRecommendations(
	result: FindPlacesResult,
	options: { durationMinutes?: number; flight?: boolean; night?: boolean } = {},
): string {
	const { origin } = result;
	const location = origin.label ?? `${origin.point.lat}, ${origin.point.lon}`;
	const candidates = result.candidates
		.filter((candidate) => !options.night || candidate.open.status === 'open')
		.filter(
			(candidate) =>
				options.durationMinutes === undefined ||
				candidate.walkMinutes + candidate.visitMinutes <= options.durationMinutes,
		)
		.slice(0, options.flight ? 2 : 3);
	const parts = [
		`Локация: ${location} (${origin.source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).`,
		`Фильтры: ${result.usedFilters.length ? result.usedFilters.join('; ') : 'дополнительные не заданы'}.`,
	];
	if (options.flight)
		parts.push(
			'Время дороги в аэропорт, регистрации и досмотра неизвестно — проверьте его и вычтите из времени до вылета. Весь запас нельзя отдавать прогулке.',
		);
	if (options.night && result.candidates.some((candidate) => candidate.open.status === 'unknown'))
		parts.push(
			'У части найденных мест часы работы неизвестны — уточните перед выходом; они исключены из ночных рекомендаций.',
		);
	if (candidates.length === 0)
		parts.push('Подходящих мест с этими условиями не найдено. Попробуйте изменить фильтры.');
	for (const [index, candidate] of candidates.entries())
		parts.push(
			`${index + 1}. ${candidate.place.name} — ${Math.round(candidate.distanceM)} м, ${candidate.walkMinutes} мин пешком (оценка).\n${placeDetails(candidate)}`,
		);
	if (result.note) parts.push(result.note);
	return parts.join('\n\n');
}

export function formatWalk(plan: WalkPlan): string {
	if (plan.stops.length === 0) return `Подходящий маршрут не найден. ${plan.note}`.trim();
	const parts = [`Пеший маршрут: всего ${plan.totalMinutes} мин, включая переходы и посещения (оценка).`];
	for (const [index, stop] of plan.stops.entries()) {
		const leg = plan.legs[index];
		parts.push(
			`${stop.order}. ${stop.candidate.place.name} — прибытие через ${stop.arriveAtMinute} мин от старта.${leg ? ` Переход: ${Math.round(leg.distanceM)} м, ${leg.walkMinutes} мин.` : ''}\n${placeDetails(stop.candidate)}`,
		);
	}
	if (plan.note) parts.push(plan.note);
	return parts.join('\n\n');
}
