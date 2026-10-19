import {
	type Candidate,
	type Category,
	type FindPlacesResult,
	type WalkPlan,
} from '@server/places/model/places.schema';
import { categoryNames } from '@server/places/usecase/categoryNames';
import 'server-only';

/** What the parsed request contributes to the text. Every field is optional: tests pass a subset. */
export interface ReplyOptions {
	categories?: readonly Category[];
	durationMinutes?: number;
	/** Place ids the user is standing at — recommending the starting landmark is no answer. */
	excludeIds?: readonly string[];
	flight?: boolean;
	interests?: readonly string[];
	night?: boolean;
	now?: Date;
	query?: string;
	walk?: boolean;
}

/** Astana is UTC+5 with no daylight saving; `hours.ts` uses the same fixed offset. */
function astanaClock(at: Date): { hour: number; text: string } {
	const minutes = Math.floor(at.getTime() / 60_000) + 5 * 60;
	const dayMinutes = ((minutes % 1440) + 1440) % 1440;
	const hour = Math.floor(dayMinutes / 60);
	return { hour, text: `${String(hour).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}` };
}

/** One sentence. `open.note` is not appended: it restates the same status in other words. */
function hours(candidate: Candidate): string {
	const { open } = candidate;
	const low =
		open.confidence === 'low' ? ' (уверенность низкая: часы разобраны частично — уточните перед выходом)' : '';
	if (open.status === 'open')
		return `открыто${open.until ? ` до ${open.until}` : ' сейчас'} по данным OpenStreetMap${low}`;
	if (open.status === 'closed')
		return `сейчас закрыто по данным OpenStreetMap${open.opensAt ? `, откроется в ${open.opensAt}` : ''}${low}`;
	return 'часы работы неизвестны — уточните перед выходом';
}

/** A route stop's reason names its leg from the plan, not the straight distance from the start. */
type DetailOptions = ReplyOptions & { legMinutes?: number | undefined };

const TAG_LABELS: Record<string, string> = {
	free: 'бесплатный вход',
	interactive: 'есть интерактивы',
	kids: 'подходит детям',
	night: 'работает ночью',
	outdoor_seating: 'есть веранда',
	power_sockets: 'есть розетки',
	view: 'есть вид на город',
	wheelchair: 'доступно для колясок',
	wifi: 'есть Wi-Fi',
};

/**
 * «Почему» from the tool result alone: the interest the place matched, the OSM tags the query
 * matched, Wikidata/OSM signals, the open status and the walk. Nothing here is generated.
 */
function reason(candidate: Candidate, options: DetailOptions): string {
	const { open, place, why } = candidate;
	const { legMinutes } = options;
	const category = categoryNames[place.category];
	const interest = options.interests?.length ? `«${options.interests.join(', ')}»` : null;
	// A walk with no stated interest matched a category set, not the user's words: say that instead.
	const matched = options.walk
		? place.category === 'cafe'
			? 'кафе — остановка на кофе'
			: `${category} — подходит для прогулки`
		: interest !== null && (options.categories?.includes(place.category) === true || why.semantic >= 0.5)
			? `${category} — совпадает с запросом ${interest}`
			: category;
	const tags = why.tags.map((tag) => TAG_LABELS[tag]).filter(Boolean);
	const known =
		place.popularity !== null && place.popularity >= 0.5
			? 'заметное место по данным Wikidata/OSM'
			: place.descriptionSource === 'wikidata'
				? 'есть описание в Wikidata'
				: null;
	return [
		matched,
		tags.length ? `по данным OSM ${tags.slice(0, 2).join(', ')}` : null,
		known,
		open.status === 'open' && open.confidence === 'high'
			? `открыто${open.until ? ` до ${open.until}` : ' сейчас'}`
			: null,
		legMinutes === undefined ? `${candidate.walkMinutes} мин пешком` : `переход ${legMinutes} мин`,
	]
		.filter(Boolean)
		.join(', ');
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

function placeDetails(candidate: Candidate, options: DetailOptions): string {
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
		`Почему: ${reason(candidate, options)}.`,
		`На посещение: ${candidate.visitMinutes} мин (оценка).`,
		...requestedFacts(candidate, options.query ?? ''),
		place.description ? `${place.description} (${descriptionSource}).` : '',
		`Что делать: ${actions[place.category] ?? 'познакомиться с местом и осмотреться'} (сгенерированная идея).`,
		`Часы: ${hours(candidate)}.`,
		`Источник места: [OpenStreetMap](${place.sourceUrl}).`,
	]
		.filter(Boolean)
		.join('\n');
}

export function selectRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): Candidate[] {
	let cafes = 0;
	return result.candidates
		.filter((candidate) => !options.excludeIds?.includes(candidate.place.id))
		.filter((candidate) => !options.night || candidate.open.status === 'open')
		.filter(
			(candidate) =>
				options.durationMinutes === undefined ||
				candidate.walkMinutes + candidate.visitMinutes <= options.durationMinutes,
		)
		.filter((candidate) => {
			// A walk with no stated interest is about sights; one coffee stop is enough.
			if (!options.walk || candidate.place.category !== 'cafe') return true;
			cafes += 1;
			return cafes <= 1;
		})
		.slice(0, options.flight ? 2 : 3);
}

const checkedAt = (at: Date) => `Часы проверены на ${astanaClock(at).text} по Астане`;

/** The tool's filters, minus the raw conversation it echoes as «Запрос». */
function filtersLine(usedFilters: readonly string[], options: ReplyOptions): string {
	const filters = usedFilters.flatMap((filter) => {
		if (filter.startsWith('Запрос: '))
			return options.interests?.length ? [`Интерес: ${options.interests.join(', ')}`] : [];
		if (filter.startsWith('Время проверки: ')) {
			const at = new Date(filter.slice('Время проверки: '.length));
			return Number.isFinite(at.getTime()) ? [checkedAt(at)] : [];
		}
		return [filter];
	});
	return `Фильтры: ${filters.length ? filters.join('; ') : 'дополнительные не заданы'}.`;
}

/** For a route the plan's legs are the walking limit; a search radius would contradict them. */
export function routeFiltersLine(options: ReplyOptions): string {
	const filters = [
		...(options.interests?.length ? [`Интерес: ${options.interests.join(', ')}`] : []),
		...(options.durationMinutes === undefined ? [] : [`Прогулка до ${options.durationMinutes} минут`]),
		...(options.categories?.length
			? [`Категории: ${options.categories.map((category) => categoryNames[category]).join(', ')}`]
			: []),
		...(options.now ? [checkedAt(options.now)] : []),
	];
	return `Фильтры: ${filters.length ? filters.join('; ') : 'дополнительные не заданы'}.`;
}

export function formatRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): string {
	const { origin } = result;
	const location = origin.label ?? `${origin.point.lat}, ${origin.point.lon}`;
	const candidates = selectRecommendations(result, options);
	const parts = [
		`Локация: ${location} (${origin.source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).`,
		filtersLine(result.usedFilters, options),
	];
	if (options.flight)
		parts.push(
			'Время дороги в аэропорт, регистрации и досмотра неизвестно — проверьте его и вычтите из времени до вылета. Весь запас нельзя отдавать прогулке.',
		);
	if (options.night && options.now) {
		const clock = astanaClock(options.now);
		// Hours are checked for now, not for a later evening the user may mean; say so plainly.
		if (clock.hour >= 6 && clock.hour < 22)
			parts.push(`Сейчас ${clock.text} по Астане — часы проверены на это время; ночью статус может отличаться.`);
	}
	if (options.night && result.candidates.some((candidate) => candidate.open.status === 'unknown'))
		parts.push(
			'У части найденных мест часы работы неизвестны — уточните перед выходом; они исключены из ночных рекомендаций.',
		);
	if (candidates.length === 0)
		parts.push('Подходящих мест с этими условиями не найдено. Попробуйте изменить фильтры.');
	for (const [index, candidate] of candidates.entries())
		parts.push(
			`${index + 1}. ${candidate.place.name} — ${Math.round(candidate.distanceM)} м, ${candidate.walkMinutes} мин пешком (оценка).\n${placeDetails(candidate, options)}`,
		);
	if (result.note) parts.push(result.note);
	return parts.join('\n\n');
}

export function formatWalk(plan: WalkPlan, options: ReplyOptions = {}): string {
	if (plan.stops.length === 0) return `Подходящий маршрут не найден. ${plan.note}`.trim();
	const parts = [
		plan.stops.length === 1
			? `Предложена одна остановка: всего ${plan.totalMinutes} мин, включая переход и посещение (оценка).`
			: `Пеший маршрут: всего ${plan.totalMinutes} мин, включая переходы и посещения (оценка).`,
	];
	for (const [index, stop] of plan.stops.entries()) {
		const leg = plan.legs[index];
		parts.push(
			`${stop.order}. ${stop.candidate.place.name} — прибытие через ${stop.arriveAtMinute} мин от старта.${leg ? ` Переход: ${Math.round(leg.distanceM)} м, ${leg.walkMinutes} мин.` : ''}\n${placeDetails(stop.candidate, { ...options, legMinutes: leg?.walkMinutes })}`,
		);
	}
	if (plan.note) parts.push(plan.note);
	return parts.join('\n\n');
}
