import {
	type Candidate,
	type Category,
	type FindPlacesResult,
	type WalkPlan,
} from '@server/places/model/places.schema';
import { categoryNames } from '@server/places/usecase/categoryNames';
import 'server-only';

function hours(candidate: Candidate): string {
	const { open } = candidate;
	let status = 'часы работы неизвестны — уточните перед выходом';
	if (open.status === 'open') status = `открыто по данным источника${open.until ? ` до ${open.until}` : ''}`;
	if (open.status === 'closed')
		status = `закрыто${open.opensAt ? `; открытие по данным источника в ${open.opensAt}` : ''}`;
	return `${status}${open.confidence === 'low' ? '; уверенность низкая' : ''}${open.note && open.note !== status ? `. ${open.note}` : ''}`;
}

function requestedFacts(candidate: Candidate, query: string): string[] {
	const text = query.toLowerCase();
	const checks = [
		{ label: 'Розетки', requested: text.includes('розетк'), tag: 'power_sockets' },
		{ label: 'Wi-Fi', requested: /wi[ -]?fi|вай[ -]?фай|интернет/u.test(text), tag: 'wifi' },
		{ label: 'Интерактивы', requested: text.includes('интерактив'), tag: 'interactive' },
	];
	return [
		...checks
			.filter((check) => check.requested)
			.map(
				(check) =>
					`${check.label}: ${candidate.place.tags.includes(check.tag) ? 'отмечены в OpenStreetMap' : 'данных нет — уточните перед выходом'}.`,
			),
		...(/тих|тишин/u.test(text) ? ['Уровень шума не проверен — уточните у места.'] : []),
	];
}

function placeDetails(candidate: Candidate, query = ''): string {
	const { place } = candidate;
	const actions: Partial<Record<Category, string>> = {
		artwork: 'осмотреть арт-объект и сделать фото',
		attraction: 'осмотреть достопримечательность и сделать короткую остановку',
		cafe: 'выпить кофе и отдохнуть перед следующей остановкой',
		gallery: 'осмотреть выставку',
		garden: 'прогуляться по саду и сделать паузу',
		library: 'почитать или спокойно поработать, предварительно уточнив правила посещения',
		monument: 'осмотреть памятник и сделать фото',
		museum: 'посмотреть экспозицию, предварительно уточнив условия входа',
		park: 'пройтись по парку и отдохнуть',
		playground: 'сделать остановку для игры с ребёнком, проверив состояние площадки на месте',
		viewpoint: 'посмотреть на город и сделать фото',
	};
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
		...requestedFacts(candidate, query),
		place.description ? `${place.description} (${descriptionSource}).` : '',
		`Что делать: ${actions[place.category] ?? 'познакомиться с местом и осмотреться'} (сгенерированная идея).`,
		`Часы: ${hours(candidate)}.`,
		`Источник места: [OpenStreetMap](${place.sourceUrl}).`,
	]
		.filter(Boolean)
		.join('\n');
}

export function selectRecommendations(
	result: FindPlacesResult,
	options: { durationMinutes?: number; flight?: boolean; night?: boolean; query?: string } = {},
): Candidate[] {
	return result.candidates
		.filter((candidate) => !options.night || candidate.open.status === 'open')
		.filter(
			(candidate) =>
				options.durationMinutes === undefined ||
				candidate.walkMinutes + candidate.visitMinutes <= options.durationMinutes,
		)
		.slice(0, options.flight ? 2 : 3);
}

export function formatRecommendations(
	result: FindPlacesResult,
	options: { durationMinutes?: number; flight?: boolean; night?: boolean; query?: string } = {},
): string {
	const { origin } = result;
	const location = origin.label ?? `${origin.point.lat}, ${origin.point.lon}`;
	const candidates = selectRecommendations(result, options);
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
			`${index + 1}. ${candidate.place.name} — ${Math.round(candidate.distanceM)} м, ${candidate.walkMinutes} мин пешком (оценка).\n${placeDetails(candidate, options.query)}`,
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
