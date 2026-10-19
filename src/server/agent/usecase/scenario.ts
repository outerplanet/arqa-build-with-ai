import { type Category, categorySchema } from '@server/places/model/places.schema';
import { LANDMARKS, mentions } from '@server/places/usecase/landmarks';
import 'server-only';

/**
 * A follow-up that narrows the current request without changing its interest. Each kind says what
 * the data can actually do with it; `formatReply.ts` says aloud what it cannot.
 * - `budget`, `free`: OSM has no prices; only `fee=no` (tag `free`) is known, and is preferred.
 * - `closer`: a smaller walking radius and the list from the nearest.
 * - `openNow`: only places whose OSM hours say «open» at the check time.
 * - `quiet`: no noise data at all — acknowledged, never applied.
 * - `noFood`: food categories are left out of the search.
 */
export type RefinementKind = 'budget' | 'closer' | 'free' | 'noFood' | 'openNow' | 'quiet';

export interface Refinement {
	kind: RefinementKind;
	/** Russian, quoted back in «Учёл: …». */
	label: string;
}

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
	/** Follow-up refinements from every turn; within a group (price) the latest wins. */
	refinements: Refinement[];
	route: boolean;
	/** «Необычное», «что посмотреть», a tourist: named, notable places beat a generic-named park. */
	sights: boolean;
	/** «Из трёх мест», «2–3 места»: the fewest and the most stops the user asked for. */
	stops?: { max: number; min: number };
	/**
	 * The latest turn, when it is a follow-up that changed nothing the parser knows: the reply must
	 * say it was not understood rather than silently repeat the previous answer.
	 */
	unrecognized?: string;
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

interface Turn extends Omit<Scenario, 'sights' | 'unrecognized' | 'walk'> {
	/** The turn names a landmark or a location phrase. */
	hasLocation: boolean;
	text: string;
	/** The turn starts a new request rather than refining the previous one. */
	topical: boolean;
	walkWords: boolean;
}

const OPEN_NOW =
	/открыт[а-я]*\s+(?:прямо\s+)?сейчас|сейчас\s+(?:\S+\s+)?(?:открыт|работа)|работа[ею]т\s+сейчас|только\s+открыт/u;

/** «Мало денег», «поближе», «открыто сейчас»… — read from one turn's own words. */
function refinementsFrom(lower: string, { followUp }: { followUp: boolean }): Refinement[] {
	const found: Refinement[] = [];
	if (/бесплатн|даром/u.test(lower)) found.push({ kind: 'free', label: 'бесплатно' });
	else if (/денег|деньг/u.test(lower) && /мало|нет|немного|без|в обрез|экономл/u.test(lower))
		found.push({ kind: 'budget', label: 'мало денег' });
	else if (/дешев|недорог|не дорог|бюджетн|эконом/u.test(lower)) found.push({ kind: 'budget', label: 'недорого' });
	// «Рядом» alone is a refinement only in a follow-up; in a first request it is the request itself.
	if (
		/(?<!\p{L})(?:по)?ближе(?!\p{L})/u.test(lower) ||
		(followUp && /(?<!\p{L})(?:рядом|недалеко)(?!\p{L})(?!\s+(?:с|со|от)\s)/u.test(lower))
	)
		found.push({ kind: 'closer', label: 'поближе' });
	if (OPEN_NOW.test(lower)) found.push({ kind: 'openNow', label: 'открыто сейчас' });
	if (/(?<!\p{L})тих|тишин|без шума|не шумн|потише/u.test(lower)) found.push({ kind: 'quiet', label: 'тихо' });
	if (/без еды|не голод|еда не нужна|не (?:хочу\s+)?есть(?!\p{L})/u.test(lower))
		found.push({ kind: 'noFood', label: 'без еды' });
	return found;
}

/** «Спасибо», «ок»: a turn that asks for nothing is not a misunderstood refinement. */
const SMALL_TALK =
	/^(?:спасибо|благодарю|ок|окей|ok|хорошо|понятно|ясно|отлично|супер|ладно|да|нет|привет|здравствуйте)[\s.!,)]*$/u;

/** Parse preferences only: facilities and flight transport times are never inferred. */
function parseTurn(text: string, { followUp = false }: { followUp?: boolean } = {}): Turn {
	const full = text.trim().toLowerCase().replaceAll('ё', 'е');
	const interestText = withoutLocation(text);
	const lower = interestText.toLowerCase().replaceAll('ё', 'е');
	const locationPhrase = interestText.length < text.trim().length;
	const hasLocation = locationPhrase || LANDMARKS.some((aliases) => aliases.some((alias) => mentions(text, alias)));
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
		hasLocation,
		interests,
		maxWalkMinutes: walking ? Math.min(90, Math.max(5, Number(walking[1]))) : 15,
		night,
		query: interestText,
		refinements: refinementsFrom(lower, { followUp }),
		route,
		stops: stopsFrom(lower),
		text: text.trim(),
		topical:
			locationPhrase ||
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

/** Kept across the conversation; a later price word replaces an earlier one («бесплатно» → «недорого»). */
function mergedRefinements(turns: readonly Turn[]): Refinement[] {
	const byGroup = new Map<string, Refinement>();
	for (const item of turns.flatMap((turn) => turn.refinements)) {
		const group = item.kind === 'free' || item.kind === 'budget' ? 'price' : item.kind;
		byGroup.delete(group);
		byGroup.set(group, item);
	}
	return [...byGroup.values()];
}

/** True when the turn set no field the parser knows: not a place, interest, time, limit or refinement. */
function changesNothing(turn: Turn): boolean {
	const lower = turn.text.toLowerCase().replaceAll('ё', 'е');
	return (
		turn.text.length > 0 &&
		!SMALL_TALK.test(lower) &&
		!turn.hasLocation &&
		!turn.flight &&
		!turn.night &&
		!turn.route &&
		!turn.accessibleOnly &&
		!turn.walkWords &&
		!turn.walkLimitExplicit &&
		turn.categories === undefined &&
		turn.durationMinutes === undefined &&
		turn.stops === undefined &&
		turn.interests.length === 0 &&
		turn.refinements.length === 0 &&
		!/днем|утром|вечером|сейчас/u.test(lower)
	);
}

function quoted(text: string): string {
	const line = text.replace(/\s+/gu, ' ').replaceAll('«', '"').replaceAll('»', '"');
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export function hasRefinement(scenario: Pick<Scenario, 'refinements'>, kind: RefinementKind): boolean {
	return scenario.refinements.some((item) => item.kind === kind);
}

const FOOD_CATEGORIES: readonly Category[] = ['restaurant', 'fast_food', 'bar', 'cafe'];

/** «Без еды»: food is left out of the search, unless coffee or a cafe is the stated interest itself. */
function withoutFood(scenario: Scenario, categories: Category[] | undefined): Category[] | undefined {
	if (!hasRefinement(scenario, 'noFood')) return categories;
	const keepCafe =
		!scenario.walk && scenario.categories?.includes('cafe') === true && !scenario.categories.includes('restaurant');
	const dropped = (categories ?? categorySchema.options).filter(
		(category) => !FOOD_CATEGORIES.includes(category) || (keepCafe && category === 'cafe'),
	);
	return dropped.length ? dropped : categories;
}

/** Later explicit preferences replace earlier ones; follow-ups («а поближе?») keep the context. */
export function scenarioFor(text: string): Scenario {
	const turns = text
		.split('\n')
		.filter((line) => line.trim())
		.map((line, index) => parseTurn(line, { followUp: index > 0 }));
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
	const refinements = mergedRefinements(turns);
	const radius = explicitWalk?.maxWalkMinutes ?? walkRadius(durationMinutes);
	return {
		accessibleOnly: turns.some((turn) => turn.accessibleOnly) || undefined,
		categories: interest?.categories,
		durationMinutes,
		flight: topic.flight,
		interests: interest?.interests.length ? interest.interests : latest.interests,
		// «Поближе» halves whatever radius applied before, never below five minutes.
		maxWalkMinutes: hasRefinement({ refinements }, 'closer') ? Math.max(5, Math.round(radius / 2)) : radius,
		night: topic.night,
		query: query || text.trim(),
		refinements,
		route,
		sights: interest?.categories === SIGHT_CATEGORIES,
		stops: turns.findLast((turn) => turn.stops !== undefined)?.stops,
		...(turns.length > 1 && changesNothing(latest) ? { unrecognized: quoted(latest.text) } : {}),
		walk: interest === undefined ? route : interest.categories === WALK_CATEGORIES,
		walkLimitExplicit: explicitWalk !== undefined,
	};
}

/**
 * Server authority over categories, without over-reach: a stated interest always wins; when the
 * user named none, the model's choice stands; a walk or route with neither gets sights and parks.
 * «Без еды» then removes food from whichever set was chosen.
 */
export function categoriesFor(
	scenario: Scenario,
	{ purpose, requested }: { purpose: 'route' | 'search'; requested?: readonly Category[] | undefined },
): Category[] | undefined {
	const walkSet = purpose === 'route' ? ROUTE_CATEGORIES : WALK_CATEGORIES;
	if (scenario.categories !== undefined) return withoutFood(scenario, scenario.walk ? walkSet : scenario.categories);
	if (requested?.length) return withoutFood(scenario, [...requested]);
	return withoutFood(scenario, scenario.walk || purpose === 'route' ? walkSet : undefined);
}
