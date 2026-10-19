import { type Category } from '@server/places/model/places.schema';
import 'server-only';

export interface Scenario {
	accessibleOnly?: boolean;
	/** Categories from the user's stated interest only — never from the location phrase. */
	categories?: Category[];
	durationMinutes?: number;
	flight: boolean;
	/** Short Russian labels of the parsed interest, quoted back in «почему» and the filters. */
	interests: string[];
	maxWalkMinutes: number;
	night: boolean;
	/** The interest text without the location phrase: what retrieval should match. */
	query: string;
	route: boolean;
	/** «Необычное», «что посмотреть», a tourist: named, notable places beat a generic-named park. */
	sights: boolean;
	/** «Из трёх мест», «2–3 места»: the fewest and the most stops the user asked for. */
	stops?: { max: number; min: number };
	/** A walk or route with no specific interest: sights and parks, at most one cafe. */
	walk: boolean;
	/** True when the user named a walking limit; a derived radius never overrides one. */
	walkLimitExplicit: boolean;
}

/** Sights and green space for a walk with no stated interest; one cafe at most is chosen later. */
export const WALK_CATEGORIES: Category[] = [
	'monument',
	'attraction',
	'artwork',
	'museum',
	'gallery',
	'viewpoint',
	'theatre',
	'park',
	'garden',
	'cafe',
];
/**
 * «Что-то необычное», «интересное», «что посмотреть»: anything worth seeing for an adult, broad
 * enough that a sparse district (EXPO) still yields two or three different places. Playgrounds and
 * food are not sights; they are asked for in their own words.
 */
export const SIGHT_CATEGORIES: Category[] = [
	'attraction',
	'artwork',
	'monument',
	'museum',
	'gallery',
	'theatre',
	'viewpoint',
	'park',
	'garden',
	'place_of_worship',
	'theme_park',
];
/** A planned route cannot cap cafes after the fact, so it leaves them out. */
const ROUTE_CATEGORIES: Category[] = WALK_CATEGORIES.filter((category) => category !== 'cafe');

/**
 * «Я у музея Нур Алем, …» names where the user is, not what they want. Stripping it keeps
 * «музея» from becoming a museum filter and the landmark name from steering retrieval.
 * A bare «у» counts only after «я» («у меня 2 часа» is a budget), and «около» never before a number.
 */
const LOCATION_PHRASE = new RegExp(
	[
		// The preposition, with «я / сейчас / нахожусь» in front of it.
		String.raw`(?<!\p{L})(?:(?:я\s+)?(?:сейчас\s+)?(?:нахожусь\s+)?(?:возле|около|рядом\s+со?|недалеко\s+от|в\s+районе)`,
		String.raw`|я\s+(?:сейчас\s+)?(?:нахожусь\s+)?у|нахожусь\s+(?:в|на|у))\s+`,
		// Not «у меня», «рядом со мной», «около 2 часов».
		String.raw`(?!(?:меня|мной|нас|нами|вас|тебя|\d|час|полчас|пар|мин))`,
		// The landmark: up to punctuation or the start of the request.
		String.raw`[^,.;!?—–\n]*?(?=[,.;!?—–\n]|\s+(?:хочу|хотим|хотелось|ищу|ищем|что|где|куда|посоветуй|посоветуйте`,
		String.raw`|подскажи|подскажите|есть|и|а|на\s+(?:\d|пар|час|полтора))(?!\p{L})|$)[,.;!?—–]?`,
	].join(''),
	'giu',
);

export function withoutLocation(text: string): string {
	return text.replace(LOCATION_PHRASE, ' ').replace(/\s+/gu, ' ').trim();
}

const WALK_LIMIT = /(?:до|в пределах|не больше|не более)\s*(\d{1,2})\s*мин[а-я]*\s*(?:пешком|ходьбы)/u;

function durationFrom(text: string): number | undefined {
	if (/полтора\s*час/u.test(text)) return 90;
	if (/пар[ауые]\s*час/u.test(text)) return 120;
	// `\b` is ASCII-only in JavaScript, so «2 ч» needs a Unicode-aware lookahead.
	const match = /(?:^|\D)(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(час[а-я]*|ч(?!\p{L})|мин[а-я]*)(?!\s*пешком)/u.exec(
		text,
	);
	if (!match) {
		if (text.includes('полчаса')) return 30;
		return /(?:на|за|есть|целый|около)\s+час(?:ок)?(?!\p{L})/u.test(text) ? 60 : undefined;
	}
	const value = Number(match[2] ?? match[1]) * (match[3]!.startsWith('ч') ? 60 : 1);
	return value > 0 ? Math.min(240, value) : undefined;
}

const STOP_NUMBERS: Record<string, number> = { '2': 2, '3': 3, два: 2, двух: 2, трех: 3, три: 3 };
const STOP_COUNT = /(?<!\p{L})(2|3|два|двух|три|трех)(?:\s*[-–—]\s*(3|три|трех))?\s+(?:мест|остановк|точ[ек])/u;

/** «Из трёх мест», «3 места», «двух-трёх остановок». The planner allows two or three stops. */
function stopsFrom(text: string): Scenario['stops'] {
	const match = STOP_COUNT.exec(text);
	if (!match) return undefined;
	const min = STOP_NUMBERS[match[1]!]!;
	const max = match[2] === undefined ? min : STOP_NUMBERS[match[2]]!;
	return { max: Math.max(min, max), min };
}

const INTEREST_LABELS: [RegExp, string][] = [
	[/ребен|детьми|детск/u, 'с ребёнком'],
	[/интерактив/u, 'интерактивы'],
	[/кофе|кофейн/u, 'кофе'],
	[/кафе/u, 'кафе'],
	[/розетк/u, 'розетка'],
	[/тих|тишин/u, 'тихое место'],
	[/библиотек/u, 'библиотека'],
	[/музе/u, 'музей'],
	[/галере|выставк/u, 'выставки'],
	[/ноч/u, 'ночью'],
	[/необыч/u, 'необычное'],
	[/интересн/u, 'интересное'],
	[/достопримеч|турист/u, 'достопримечательности'],
	[/поесть|ресторан|обед|ужин/u, 'поесть'],
	[/парк|набережн|свеж[а-я]*\s+воздух/u, 'парк и свежий воздух'],
	[/прогул|гуля|пройтись/u, 'прогулка'],
];

interface Turn extends Omit<Scenario, 'sights' | 'walk'> {
	/** The turn starts a new request rather than refining the previous one. */
	topical: boolean;
	walkWords: boolean;
}

/** Parse preferences only: facilities and flight transport times are never inferred. */
function parseTurn(text: string): Turn {
	const full = text.trim().toLowerCase().replaceAll('ё', 'е');
	const interestText = withoutLocation(text);
	const lower = interestText.toLowerCase().replaceAll('ё', 'е');
	const hasLocation = interestText.length < text.trim().length;
	const flight = /вылет|рейс|самолет|аэропорт/u.test(full);
	const night = /ноч[а-я]*/u.test(lower);
	const route = /маршрут|составь.*прогул|построй.*прогул|пройти.*(?:все|эт[иом])|(?:соедини|объедини).*мест/u.test(
		lower,
	);
	const accessibleOnly = /коляск|безбарьер|доступн[а-я]*\s+(?:сред|для.*инвалид)/u.test(full) || undefined;
	const walkWords = /прогул|гуля|пройтись/u.test(lower);
	let categories: Category[] | undefined;
	if (/ребен|детьми|детск|площадк|интерактив/u.test(lower)) categories = ['playground', 'museum', 'zoo'];
	else if (/кофе|кафе|кофейн|розетк|библиотек/u.test(lower)) categories = ['cafe', 'library'];
	else if (/музе|галере|выставк/u.test(lower)) categories = ['museum', 'gallery'];
	else if (night) categories = ['bar', 'nightclub', 'viewpoint', 'artwork', 'attraction'];
	else if (/достопримеч|турист|необыч|интересн|посмотреть|экспо|expo/u.test(lower)) categories = SIGHT_CATEGORIES;
	else if (/поесть|ресторан|обед|ужин/u.test(lower)) categories = ['restaurant', 'cafe', 'fast_food'];
	else if (/парк|набережн|свеж[а-я]*\s+воздух/u.test(lower)) categories = ['park', 'garden', 'viewpoint', 'artwork'];
	else if (walkWords) categories = WALK_CATEGORIES;
	const walking = WALK_LIMIT.exec(lower);
	// Walking proximity is not a total time budget, even when it is the first number in a request.
	const durationMinutes = durationFrom(lower.replace(/\d{1,2}\s*мин[а-я]*\s*(?:пешком|ходьбы)/gu, ''));
	const interests = [
		...new Set(INTEREST_LABELS.filter(([pattern]) => pattern.test(lower)).map(([, label]) => label)),
	].slice(0, 2);
	return {
		accessibleOnly,
		categories,
		durationMinutes,
		flight,
		interests,
		maxWalkMinutes: walking ? Math.min(90, Math.max(5, Number(walking[1]))) : 15,
		night,
		query: interestText,
		route,
		stops: stopsFrom(lower),
		topical:
			hasLocation ||
			flight ||
			night ||
			categories !== undefined ||
			durationMinutes !== undefined ||
			/днем|утром|вечером|сейчас/u.test(lower),
		walkLimitExplicit: walking !== null,
		walkWords,
	};
}

/** A time budget sets how far one stop may be: a quarter of it, between 10 and 30 minutes. */
function walkRadius(durationMinutes: number | undefined): number {
	return durationMinutes === undefined ? 15 : Math.min(30, Math.max(10, Math.round(durationMinutes / 4)));
}

/** Later explicit preferences replace earlier ones; follow-ups («а поближе?») keep the context. */
export function scenarioFor(text: string): Scenario {
	const turns = text
		.split('\n')
		.filter((line) => line.trim())
		.map(parseTurn);
	const latest = turns.at(-1) ?? parseTurn('');
	const topic = turns.findLast((turn) => turn.topical) ?? latest;
	const interest = turns.findLast((turn) => turn.categories !== undefined);
	const durationMinutes = turns.findLast((turn) => turn.durationMinutes !== undefined)?.durationMinutes;
	const explicitWalk = turns.findLast((turn) => turn.walkLimitExplicit);
	const { route } = latest;
	const query = turns
		.map((turn) => turn.query)
		.filter(Boolean)
		.join('\n');
	return {
		accessibleOnly: turns.some((turn) => turn.accessibleOnly) || undefined,
		categories: interest?.categories,
		durationMinutes,
		flight: topic.flight,
		interests: interest?.interests.length ? interest.interests : latest.interests,
		maxWalkMinutes: explicitWalk?.maxWalkMinutes ?? walkRadius(durationMinutes),
		night: topic.night,
		query: query || text.trim(),
		route,
		sights: interest?.categories === SIGHT_CATEGORIES,
		stops: turns.findLast((turn) => turn.stops !== undefined)?.stops,
		walk: interest === undefined ? route : interest.categories === WALK_CATEGORIES,
		walkLimitExplicit: explicitWalk !== undefined,
	};
}

/**
 * Server authority over categories, without over-reach: a stated interest always wins; when the
 * user named none, the model's choice stands; a walk or route with neither gets sights and parks.
 */
export function categoriesFor(
	scenario: Scenario,
	{ purpose, requested }: { purpose: 'route' | 'search'; requested?: readonly Category[] | undefined },
): Category[] | undefined {
	const walkSet = purpose === 'route' ? ROUTE_CATEGORIES : WALK_CATEGORIES;
	if (scenario.categories !== undefined) return scenario.walk ? walkSet : scenario.categories;
	if (requested?.length) return [...requested];
	return scenario.walk || purpose === 'route' ? walkSet : undefined;
}
