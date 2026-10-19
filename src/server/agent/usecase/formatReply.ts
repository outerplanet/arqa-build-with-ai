import { type ChatResponse } from '@server/agent/model/agent.schema';
import {
	type Candidate,
	type Category,
	type FindPlacesResult,
	type WalkPlan,
} from '@server/places/model/places.schema';
import { isGenericName, isNotable } from '@server/places/model/rank';
import { legCapMinutes } from '@server/places/model/route';
import { categoryNames } from '@server/places/usecase/categoryNames';
import 'server-only';

/** One card: the same selection and the same words as the numbered item in the text reply. */
export type Recommendation = NonNullable<ChatResponse['recommendations']>[number];

/** The text reply and its structured twin, produced together so they cannot disagree. */
export interface Rendered {
	recommendations: Recommendation[];
	text: string;
}

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
	/** «Необычное», «что посмотреть», a tourist: a generic-named park is not a sight. */
	sights?: boolean;
	/** The number of stops the user asked for, if any. */
	stops?: { max: number; min: number } | undefined;
	walk?: boolean;
	/** The pedestrian-network caveat from plan_walk's walkingRoute, said once. */
	walkingNote?: string | undefined;
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

/** For a sightseer only a named, notable place «совпадает»; a park nearby is said to be a park. */
function matchesInterest(candidate: Candidate, options: DetailOptions): boolean {
	const { place, why } = candidate;
	// «Кофейня» does match «кофе»; only a sight has to be more than its category word.
	if (options.sights) return isNotable(place) && !['garden', 'park'].includes(place.category);
	return options.categories?.includes(place.category) === true || why.semantic >= 0.5;
}

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
		: interest !== null && matchesInterest(candidate, options)
			? `${category} — совпадает с запросом ${interest}`
			: options.sights && ['garden', 'park'].includes(place.category)
				? `${category} рядом — для прогулки, не достопримечательность`
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

const ACTIONS: Partial<Record<Category, string>> = {
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

/** The structured item. Every text line about a place is rendered from this object. */
function recommendationFor(
	candidate: Candidate,
	{
		options,
		position,
	}: { options: DetailOptions; position: { distanceM: number; order: number; walkMinutes: number } },
): Recommendation {
	return {
		action: ACTIONS[candidate.place.category] ?? 'познакомиться с местом и осмотреться',
		distanceM: position.distanceM,
		hours: hours(candidate),
		order: position.order,
		placeId: candidate.place.id,
		visitMinutes: Math.round(candidate.visitMinutes),
		walkMinutes: position.walkMinutes,
		why: reason(candidate, options),
	};
}

function placeDetails(candidate: Candidate, { item, query }: { item: Recommendation; query?: string }): string {
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
		`Почему: ${item.why}.`,
		`На посещение: ${item.visitMinutes} мин (оценка).`,
		...requestedFacts(candidate, query ?? ''),
		place.description ? `${place.description} (${descriptionSource}).` : '',
		`Что делать: ${item.action} (сгенерированная идея).`,
		`Часы: ${item.hours}.`,
		`Источник места: [OpenStreetMap](${place.sourceUrl}).`,
	]
		.filter(Boolean)
		.join('\n');
}

export function selectRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): Candidate[] {
	let cafes = 0;
	const eligible = result.candidates
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
		});
	// A «Сквер» is no answer to «что посмотреть» while anything named is within reach.
	const named = options.sights ? eligible.filter((candidate) => !isGenericName(candidate.place.name)) : eligible;
	const chosen = (named.length ? named : eligible).slice(0, options.flight ? 2 : 3);
	// At night the nearest open place is the useful one: list by distance, and the reply says so.
	return options.night ? chosen.toSorted((left, right) => left.distanceM - right.distanceM) : chosen;
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

function stopsLabel(stops: { max: number; min: number }): string {
	return stops.min === stops.max ? String(stops.min) : `${stops.min}–${stops.max}`;
}

/** For a route the plan's legs are the walking limit; a search radius would contradict them. */
export function routeFiltersLine(options: ReplyOptions): string {
	const filters = [
		...(options.interests?.length ? [`Интерес: ${options.interests.join(', ')}`] : []),
		...(options.durationMinutes === undefined
			? []
			: [
					`Вся прогулка — до ${options.durationMinutes} мин, включая переходы и посещения`,
					`один переход — до ${Math.round(legCapMinutes(options.durationMinutes))} мин пешком`,
				]),
		...(options.stops ? [`Мест в маршруте: ${stopsLabel(options.stops)}`] : []),
		...(options.categories?.length
			? [`Категории: ${options.categories.map((category) => categoryNames[category]).join(', ')}`]
			: []),
		...(options.now ? [checkedAt(options.now)] : []),
	];
	return `Фильтры: ${filters.length ? filters.join('; ') : 'дополнительные не заданы'}.`;
}

const STOP_WORDS: Record<number, string> = { 1: 'Одно место', 2: 'Два места', 3: 'Три места' };
const stopsNoun = (count: number) => (count === 1 ? 'остановка' : count < 5 ? 'остановки' : 'остановок');

export function renderRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): Rendered {
	const { origin } = result;
	const location = origin.label ?? `${origin.point.lat}, ${origin.point.lon}`;
	const candidates = selectRecommendations(result, options);
	const recommendations = candidates.map((candidate, index) =>
		recommendationFor(candidate, {
			options,
			position: { distanceM: candidate.distanceM, order: index + 1, walkMinutes: candidate.walkMinutes },
		}),
	);
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
	if (options.night && candidates.length > 1) parts.push('Места перечислены от ближнего к дальнему.');
	if (options.sights && candidates.some((candidate) => !isNotable(candidate.place)))
		parts.push(
			'Поблизости в данных мало музеев, галерей и арт-объектов, поэтому в списке есть места просто для прогулки.',
		);
	if (candidates.length === 0)
		parts.push('Подходящих мест с этими условиями не найдено. Попробуйте изменить фильтры.');
	for (const [index, candidate] of candidates.entries()) {
		const item = recommendations[index]!;
		parts.push(
			`${item.order}. ${candidate.place.name} — ${Math.round(item.distanceM)} м, ${item.walkMinutes} мин пешком (оценка).\n${placeDetails(candidate, { item, query: options.query })}`,
		);
	}
	if (result.note) parts.push(result.note);
	return { recommendations, text: parts.join('\n\n') };
}

export function formatRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): string {
	return renderRecommendations(result, options).text;
}

export function renderWalk(plan: WalkPlan, options: ReplyOptions = {}): Rendered {
	const wanted = options.stops?.min;
	const short =
		wanted !== undefined && plan.stops.length < wanted && options.durationMinutes !== undefined
			? `${STOP_WORDS[wanted] ?? `${wanted} места`} за ${options.durationMinutes} мин не помещаются с учётом переходов и посещений${plan.stops.length ? ` — в маршруте ${plan.stops.length} ${stopsNoun(plan.stops.length)}` : ''}.`
			: null;
	if (plan.stops.length === 0)
		return {
			recommendations: [],
			text: [short ?? 'Подходящий маршрут не найден.', plan.note].filter(Boolean).join(' '),
		};
	const recommendations = plan.stops.map((stop, index) => {
		const leg = plan.legs[index];
		return recommendationFor(stop.candidate, {
			options: { ...options, legMinutes: leg?.walkMinutes },
			position: {
				distanceM: leg?.distanceM ?? stop.candidate.distanceM,
				order: stop.order,
				walkMinutes: leg?.walkMinutes ?? stop.candidate.walkMinutes,
			},
		});
	});
	const parts = [
		plan.stops.length === 1
			? `Предложена одна остановка: всего ${plan.totalMinutes} мин, включая переход и посещение (оценка).`
			: `Пеший маршрут: всего ${plan.totalMinutes} мин, включая переходы и посещения (оценка).`,
	];
	if (short) parts.push(short);
	for (const [index, stop] of plan.stops.entries()) {
		const item = recommendations[index]!;
		parts.push(
			`${item.order}. ${stop.candidate.place.name} — прибытие через ${stop.arriveAtMinute} мин от старта. Переход: ${Math.round(item.distanceM)} м, ${item.walkMinutes} мин.\n${placeDetails(stop.candidate, { item, query: options.query })}`,
		);
	}
	const notes = [plan.note, options.walkingNote].filter(Boolean).join(' ');
	if (notes) parts.push(notes);
	return { recommendations, text: parts.join('\n\n') };
}

export function formatWalk(plan: WalkPlan, options: ReplyOptions = {}): string {
	return renderWalk(plan, options).text;
}
