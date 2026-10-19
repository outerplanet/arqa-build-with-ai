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
import { type Refinement, type RefinementKind } from './scenario';

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
	/** Follow-up refinements («мало денег», «поближе»…), acknowledged and applied where data allows. */
	refinements?: readonly Refinement[];
	/** «Необычное», «что посмотреть», a tourist: a generic-named park is not a sight. */
	sights?: boolean;
	/** The number of stops the user asked for, if any. */
	stops?: { max: number; min: number } | undefined;
	/** A follow-up the parser did not understand, quoted back honestly. */
	unrecognized?: string | undefined;
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

/**
 * A route stop's reason names its leg from the plan, not the straight distance from the start.
 * `repeat` counts earlier items of the same category in this answer, so three cafes do not read as
 * one sentence pasted three times; `nearest` marks the closest of several.
 */
type DetailOptions = ReplyOptions & { legMinutes?: number | undefined; nearest?: boolean; repeat?: number };

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

const SIGHT = (candidate: Candidate) =>
	isNotable(candidate.place) && !['garden', 'park'].includes(candidate.place.category);
const inCategory =
	(...categories: Category[]) =>
	(candidate: Candidate) =>
		categories.includes(candidate.place.category);
const tagged = (tag: string) => (candidate: Candidate) => candidate.place.tags.includes(tag);

/**
 * What in the data shows that a place answers each parsed interest. An interest with no evidence
 * here — «тихое место», or «розетка» without the OSM tag — is never claimed as matched; its own
 * honest line («Розетки: данных нет») says so instead.
 */
const INTEREST_EVIDENCE: Record<string, (candidate: Candidate, options: DetailOptions) => boolean> = {
	библиотека: inCategory('library'),
	выставки: inCategory('gallery', 'museum'),
	достопримечательности: SIGHT,
	интерактивы: tagged('interactive'),
	интересное: SIGHT,
	кафе: inCategory('cafe'),
	кофе: inCategory('cafe'),
	музей: inCategory('museum'),
	необычное: SIGHT,
	ночью: (candidate, options) =>
		tagged('night')(candidate) || (options.night === true && candidate.open.status === 'open'),
	'парк и свежий воздух': inCategory('park', 'garden'),
	поесть: inCategory('restaurant', 'cafe', 'fast_food'),
	прогулка: inCategory('park', 'garden', 'viewpoint', 'artwork', 'monument', 'attraction'),
	розетка: tagged('power_sockets'),
	'с ребёнком': (candidate) => inCategory('playground', 'zoo', 'theme_park')(candidate) || tagged('kids')(candidate),
};

/** Only the interests the data confirms for this place, in the user's order. */
function matchedInterests(candidate: Candidate, options: DetailOptions): string[] {
	return (options.interests ?? []).filter((label) => INTEREST_EVIDENCE[label]?.(candidate, options) === true);
}

/** The first clause of «почему», worded differently for a second and third place of one kind. */
function matchedClause(candidate: Candidate, options: DetailOptions): string {
	const { place } = candidate;
	const category = categoryNames[place.category];
	const repeat = options.repeat ?? 0;
	// A walk with no stated interest matched a category set, not the user's words: say that instead.
	if (options.walk) {
		if (place.category === 'cafe') return 'кафе — остановка на кофе';
		return [`${category} — подходит для прогулки`, `ещё ${category} для прогулки`, `${category} — тоже для прогулки`][
			repeat % 3
		]!;
	}
	const matched = matchedInterests(candidate, options);
	if (matched.length) {
		const interest = `«${matched.join(', ')}»`;
		return [
			`${category} — совпадает с запросом ${interest}`,
			`ещё ${category} по запросу ${interest}`,
			`${category}, тоже по запросу ${interest}`,
		][repeat % 3]!;
	}
	if (options.sights && ['garden', 'park'].includes(place.category))
		return `${category} рядом — для прогулки, не достопримечательность`;
	if (place.category === 'playground') return 'детская площадка рядом';
	return category;
}

/** A Wikidata or OSM description, short enough for one clause. Generated text is never a reason. */
function descriptionClause(candidate: Candidate): string | null {
	const { description, descriptionSource } = candidate.place;
	// A long description keeps its own line rather than being cut mid-thought.
	if (!description || description.length > 160 || (descriptionSource !== 'wikidata' && descriptionSource !== 'osm'))
		return null;
	return `описание ${descriptionSource === 'wikidata' ? 'Wikidata' : 'OpenStreetMap'}: «${description}»`;
}

/**
 * «Почему» from the tool result alone: the interest the place matched, the OSM tags the query
 * matched, Wikidata/OSM signals, the open status and the walk. Nothing here is generated.
 */
function reason(candidate: Candidate, options: DetailOptions): string {
	const { open, place, why } = candidate;
	const { legMinutes } = options;
	const tags = why.tags.map((tag) => TAG_LABELS[tag]).filter(Boolean);
	return [
		matchedClause(candidate, options),
		tags.length ? `по данным OSM ${tags.slice(0, 2).join(', ')}` : null,
		descriptionClause(candidate),
		place.popularity !== null && place.popularity >= 0.5 ? 'заметное место по данным Wikidata/OSM' : null,
		open.status === 'open' && open.confidence === 'high'
			? `открыто${open.until ? ` до ${open.until}` : ' сейчас'}`
			: null,
		legMinutes === undefined ? `${candidate.walkMinutes} мин пешком` : `переход ${legMinutes} мин`,
		options.nearest ? 'ближе всех из предложенных' : null,
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

/** Generated ideas, several per category: the second gallery in one answer gets a different one. */
const ACTIONS: Partial<Record<Category, readonly string[]>> = {
	artwork: [
		'осмотреть арт-объект и сделать фото',
		'найти удачный ракурс для снимка',
		'остановиться на пару минут рядом',
	],
	attraction: [
		'осмотреть достопримечательность и сделать короткую остановку',
		'обойти вокруг и сделать пару снимков',
		'заглянуть ненадолго по пути',
	],
	cafe: [
		'выпить кофе и отдохнуть перед следующей остановкой',
		'взять кофе с собой и пройтись дальше',
		'сделать короткую паузу на кофе',
	],
	gallery: [
		'осмотреть выставку',
		'пройтись по залам и посмотреть, что выставлено сейчас',
		'заглянуть на текущую экспозицию, уточнив её заранее',
	],
	garden: ['прогуляться по саду и сделать паузу', 'пройтись по дорожкам сада не спеша'],
	library: [
		'почитать или спокойно поработать, предварительно уточнив правила посещения',
		'спокойно посидеть с книгой, уточнив правила посещения',
	],
	monument: [
		'осмотреть памятник и сделать фото',
		'остановиться у памятника на пару минут',
		'сделать снимок на память',
	],
	museum: [
		'посмотреть экспозицию, предварительно уточнив условия входа',
		'выбрать один-два зала и не торопиться, уточнив часы',
		'заглянуть на экспозицию, проверив условия входа заранее',
	],
	park: ['пройтись по парку и отдохнуть', 'сделать неспешный круг и передохнуть', 'прогуляться и подышать воздухом'],
	playground: [
		'сделать остановку для игры с ребёнком, проверив состояние площадки на месте',
		'дать ребёнку поиграть, пока вы отдыхаете рядом',
	],
	viewpoint: ['посмотреть на город и сделать фото', 'задержаться ради вида на город'],
};
const DEFAULT_ACTIONS = ['познакомиться с местом и осмотреться', 'заглянуть и осмотреться на месте'];

function actionFor(candidate: Candidate, repeat: number): string {
	const { category, tags } = candidate.place;
	// Only an explicit OSM tag lets the idea mention it.
	if (category === 'cafe' && repeat === 0 && tags.includes('outdoor_seating'))
		return 'выпить кофе на веранде (веранда отмечена в OSM)';
	const ideas = ACTIONS[category] ?? DEFAULT_ACTIONS;
	return ideas[repeat % ideas.length]!;
}

/** The structured item. Every text line about a place is rendered from this object. */
function recommendationFor(
	candidate: Candidate,
	{
		options,
		position,
	}: { options: DetailOptions; position: { distanceM: number; order: number; walkMinutes: number } },
): Recommendation {
	return {
		action: actionFor(candidate, options.repeat ?? 0),
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
		// A Wikidata or OSM description is already quoted in «почему»; only a generated one stands alone.
		place.description && descriptionClause(candidate) === null ? `${place.description} (${descriptionSource}).` : '',
		`Что делать: ${item.action} (сгенерированная идея).`,
		`Часы: ${item.hours}.`,
		`Источник места: [OpenStreetMap](${place.sourceUrl}).`,
	]
		.filter(Boolean)
		.join('\n');
}

const has = (options: ReplyOptions, kind: RefinementKind) =>
	options.refinements?.some((item) => item.kind === kind) === true;
const pricey = (options: ReplyOptions) => has(options, 'budget') || has(options, 'free');
const byDistance = (options: ReplyOptions) => options.night === true || has(options, 'closer');

export function selectRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): Candidate[] {
	let cafes = 0;
	const filtered = result.candidates
		.filter((candidate) => !options.excludeIds?.includes(candidate.place.id))
		// «Открыто сейчас» needs positive evidence, exactly as night does.
		.filter((candidate) => !(options.night || has(options, 'openNow')) || candidate.open.status === 'open')
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
	// Prices are not in the data; only an explicit `fee=no` is, so those places go first. Stable sort.
	const eligible = pricey(options)
		? filtered.toSorted(
				(left, right) => Number(right.place.tags.includes('free')) - Number(left.place.tags.includes('free')),
			)
		: filtered;
	// A «Сквер» is no answer to «что посмотреть» while anything named is within reach.
	const named = options.sights ? eligible.filter((candidate) => !isGenericName(candidate.place.name)) : eligible;
	const chosen = (named.length ? named : eligible).slice(0, options.flight ? 2 : 3);
	// At night or «поближе» the nearest place is the useful one: list by distance, and the reply says so.
	return byDistance(options) ? chosen.toSorted((left, right) => left.distanceM - right.distanceM) : chosen;
}

const checkedAt = (at: Date) => `Часы проверены на ${astanaClock(at).text} по Астане`;

/** The refinements as filter chips; a route applies neither «поближе» nor «открыто сейчас». */
function refinementFilters(options: ReplyOptions, { route = false } = {}): string[] {
	const chips: Record<RefinementKind, string | null> = {
		budget: 'Бюджет: цены не проверены',
		closer: route ? null : 'Поближе: по расстоянию',
		free: 'Бесплатно: только по отметке fee=no в OSM',
		noFood: 'Без еды',
		openNow: route ? null : 'Только открытые сейчас',
		quiet: 'Тихо: шум не проверен',
	};
	return (options.refinements ?? []).flatMap((item) => chips[item.kind] ?? []);
}

/** The tool's filters, minus the raw conversation it echoes as «Запрос». */
function filtersLine(usedFilters: readonly string[], options: ReplyOptions): string {
	const filters = [
		...usedFilters.flatMap((filter) => {
			if (filter.startsWith('Запрос: '))
				return options.interests?.length ? [`Интерес: ${options.interests.join(', ')}`] : [];
			if (filter.startsWith('Время проверки: ')) {
				const at = new Date(filter.slice('Время проверки: '.length));
				return Number.isFinite(at.getTime()) ? [checkedAt(at)] : [];
			}
			return [filter];
		}),
		...refinementFilters(options),
	];
	return `Фильтры: ${filters.length ? filters.join('; ') : 'дополнительные не заданы'}.`;
}

const TWO_GIS = 'по ссылке «Открыть в 2ГИС»';

function priceNote(kind: 'budget' | 'free', { free, route }: { free: readonly Candidate[]; route: boolean }): string {
	if (free.length) {
		const names = free.map((candidate) => candidate.place.name).join(', ');
		return `Бесплатный вход отмечен в OpenStreetMap (fee=no) у: ${names}${route ? '' : free.length === 1 ? ' — это место в списке первым' : ' — эти места в списке первыми'}. Других цен в данных OpenStreetMap нет — стоимость остальных уточните ${TWO_GIS}.`;
	}
	return kind === 'free'
		? `Бесплатный вход ни у одного из предложенных мест в OpenStreetMap не отмечен, а цен в данных нет — проверить стоимость не могу; уточните ${TWO_GIS}.`
		: `Цен в данных OpenStreetMap нет — проверить стоимость не могу; цены уточните ${TWO_GIS}.`;
}

/**
 * «Учёл: …» — every refinement is said back, with what was applied and what the data cannot check.
 * `pool` is everything the search returned, so excluded places can be counted honestly.
 */
export function refinementNote(
	options: ReplyOptions,
	{
		chosen,
		pool = chosen,
		route = false,
	}: { chosen: readonly Candidate[]; pool?: readonly Candidate[]; route?: boolean },
): string | null {
	const refinements = options.refinements ?? [];
	if (!refinements.length) return null;
	const skipped = route ? refinements.filter((item) => item.kind === 'closer' || item.kind === 'openNow') : [];
	const applied = refinements.filter((item) => !skipped.includes(item));
	const sentences = applied.length ? [`Учёл: ${applied.map((item) => item.label).join(', ')}.`] : [];
	for (const item of applied) {
		if (item.kind === 'budget' || item.kind === 'free')
			sentences.push(
				priceNote(item.kind, { free: chosen.filter((candidate) => candidate.place.tags.includes('free')), route }),
			);
		if (item.kind === 'closer') sentences.push('Радиус поиска сокращён, места перечислены от ближнего к дальнему.');
		if (item.kind === 'openNow')
			sentences.push(
				`Показываю только места, открытые сейчас по часам OpenStreetMap${pool.some((candidate) => candidate.open.status === 'unknown') ? '; места с неизвестными часами исключены — их часы стоит уточнить' : ''}.`,
			);
		if (item.kind === 'quiet') sentences.push('Уровня шума в данных нет — тишину проверить не могу.');
		if (item.kind === 'noFood') {
			const food: Category[] = ['restaurant', 'fast_food', 'cafe'];
			sentences.push(
				options.categories?.length && options.categories.every((category) => food.includes(category))
					? 'Без еды не получится: ваш запрос сам про еду, поэтому категории не менял.'
					: !options.walk && options.categories?.includes('cafe') && !options.categories.includes('restaurant')
						? 'Рестораны, фастфуд и бары исключены из поиска; кафе оставлены — кофе в вашем запросе.'
						: 'Рестораны, кафе, фастфуд и бары исключены из поиска.',
			);
		}
	}
	if (skipped.length)
		sentences.push(
			`Для маршрута не применял: ${skipped.map((item) => item.label).join(', ')} — переходы и часы указаны у каждой остановки.`,
		);
	return sentences.join(' ');
}

/** A follow-up that changed nothing: say so, and say what was kept and what can be asked. */
export function unrecognizedLine(options: ReplyOptions, where: string | null): string | null {
	if (options.unrecognized === undefined) return null;
	const what = options.interests?.length ? options.interests.join(', ') : 'места';
	return `Не понял уточнение «${options.unrecognized}» — учёл прежний запрос: ${what} рядом с ${where === null ? 'вами' : `«${where}»`}. Могу учесть: расстояние, время, часы работы, категорию, доступность.`;
}

/** How many earlier items share each item's category, and which one is the nearest of several. */
function positionsOf(candidates: readonly Candidate[], { sorted }: { sorted: boolean }) {
	const closest = Math.min(...candidates.map((candidate) => candidate.distanceM));
	const nearest = candidates.findIndex((candidate) => candidate.distanceM === closest);
	return candidates.map((candidate, index) => ({
		// Already listed from the nearest: saying it again would be noise.
		nearest: !sorted && candidates.length > 1 && index === nearest,
		repeat: candidates.slice(0, index).filter((other) => other.place.category === candidate.place.category).length,
	}));
}

function stopsLabel(stops: { max: number; min: number }): string {
	return stops.min === stops.max ? String(stops.min) : `${stops.min}–${stops.max}`;
}

/**
 * For a route the plan's legs are the walking limit; a search radius would contradict them.
 * `start` names the confirmed origin, so a route planned without a separate search still shows it.
 */
export function routeFiltersLine(options: ReplyOptions, { start }: { start?: string } = {}): string {
	const filters = [
		...(start === undefined ? [] : [`Старт: ${start}`]),
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
		...refinementFilters(options, { route: true }),
	];
	return `Фильтры: ${filters.length ? filters.join('; ') : 'дополнительные не заданы'}.`;
}

const STOP_WORDS: Record<number, string> = { 1: 'Одно место', 2: 'Два места', 3: 'Три места' };
const stopsNoun = (count: number) => (count === 1 ? 'остановка' : count < 5 ? 'остановки' : 'остановок');

export function renderRecommendations(result: FindPlacesResult, options: ReplyOptions = {}): Rendered {
	const { origin } = result;
	const location = origin.label ?? `${origin.point.lat}, ${origin.point.lon}`;
	const candidates = selectRecommendations(result, options);
	const positions = positionsOf(candidates, { sorted: byDistance(options) });
	const recommendations = candidates.map((candidate, index) =>
		recommendationFor(candidate, {
			options: { ...options, ...positions[index] },
			position: { distanceM: candidate.distanceM, order: index + 1, walkMinutes: candidate.walkMinutes },
		}),
	);
	const unrecognized = unrecognizedLine(options, origin.label);
	const refined = refinementNote(options, { chosen: candidates, pool: result.candidates });
	const parts = [
		...(unrecognized === null ? [] : [unrecognized]),
		`Локация: ${location} (${origin.source === 'browser' ? 'геолокация браузера' : 'из ваших слов'}).`,
		filtersLine(result.usedFilters, options),
		...(refined === null ? [] : [refined]),
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
	// «Поближе» already says it in its own note.
	if (options.night && !has(options, 'closer') && candidates.length > 1)
		parts.push('Места перечислены от ближнего к дальнему.');
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
	const positions = positionsOf(
		plan.stops.map((stop) => stop.candidate),
		{ sorted: true },
	);
	const recommendations = plan.stops.map((stop, index) => {
		const leg = plan.legs[index];
		return recommendationFor(stop.candidate, {
			options: { ...options, ...positions[index], legMinutes: leg?.walkMinutes },
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
