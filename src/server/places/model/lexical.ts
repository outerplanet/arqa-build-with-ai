import 'server-only';
import { type Place } from './places.schema';

// Retrieval preferences for a city walk, not a hard filter or evidence of access/opening.
const WALK_CATEGORIES = ['park', 'garden', 'viewpoint', 'artwork', 'monument', 'attraction'];
const SYNONYMS: Record<string, readonly string[]> = {
	бала: ['playground', 'zoo', 'museum', 'kids'],
	бесплат: ['free'],
	вайф: ['wifi'],
	веранд: ['outdoor_seating'],
	вид: ['viewpoint', 'view'],
	галере: ['gallery'],
	дет: ['playground', 'zoo', 'museum', 'kids'],
	достопримечательност: ['attraction', 'monument', 'artwork'],
	зоопарк: ['zoo'],
	интернет: ['wifi'],
	кафе: ['cafe'],
	кино: ['cinema'],
	кітап: ['library'],
	кітапхан: ['library'],
	коляск: ['wheelchair'],
	коф: ['cafe'],
	маршрут: WALK_CATEGORIES,
	музе: ['museum'],
	мұражай: ['museum'],
	ноч: ['bar', 'nightclub', 'night'],
	памятник: ['monument'],
	парк: ['park', 'garden'],
	площадк: ['playground'],
	прогул: WALK_CATEGORIES,
	ребен: ['playground', 'zoo', 'museum', 'kids'],
	ресторан: ['restaurant'],
	розетк: ['power_sockets'],
	саябақ: ['park', 'garden'],
	серуен: WALK_CATEGORIES,
	смотров: ['viewpoint', 'view'],
	театр: ['theatre'],
	тегін: ['free'],
	террас: ['outdoor_seating'],
	тих: ['library', 'park', 'cafe'],
	түн: ['bar', 'nightclub', 'night'],
	тыныш: ['library', 'park', 'cafe'],
};
const STOP_WORDS = new Set(['в', 'во', 'где', 'для', 'и', 'или', 'мне', 'на', 'с', 'со', 'у', 'хочу', 'я']);

function normalize(word: string): string {
	const lowered = word.normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
	// A deliberately small Russian stemmer, not morphology: retain at least three characters.
	return lowered.length > 4
		? lowered.replace(
				/(?:и?ями|ами|ого|ему|ому|ыми|ими|ий|ый|ой|ая|яя|ое|ее|ые|ие|ов|ев|ам|ям|ах|ях|ом|ем|а|я|ы|и|у|ю|е|о|ь)$/,
				'',
			)
		: lowered;
}

// Query framing should not dilute wishes; keep these words searchable in POI names/descriptions.
const QUERY_STOP_WORDS = new Set(
	[
		'меня',
		'места',
		'место',
		'минут',
		'минуту',
		'минуты',
		'мной',
		'найди',
		'найти',
		'недалеко',
		'от',
		'пожалуйста',
		'построй',
		'рядом',
		'составь',
		'сходить',
		'час',
		'часа',
		'часов',
	].map(normalize),
);

function tokens(text: string): string[] {
	return (
		(
			text
				.normalize('NFKC')
				.toLowerCase()
				.replaceAll('ё', 'е')
				// Join conventional network spellings before punctuation splits them into two tokens.
				.replaceAll(
					/(?<![\p{L}\p{N}_])(?:wi[\s\u2010-\u2015-]+fi|вай[\s\u2010-\u2015-]+фай)(?![\p{L}\p{N}_])/gu,
					'wifi',
				)
				.match(/[\p{L}\p{N}_]+/gu) ?? []
		)
			.filter((word) => !STOP_WORDS.has(word))
			.map(normalize)
	);
}

function matchesFamily(word: string, stem: string): boolean {
	// Short stems must not confuse видео with вид or детектив with дети.
	if (stem === 'вид') return ['вид', 'вида', 'виду', 'виды'].includes(word);
	if (stem === 'дет') return ['дет', 'детей', 'дети'].includes(word) || word.startsWith('детск');
	return word.startsWith(stem);
}

function expansionsFor(word: string): string[] {
	return Object.entries(SYNONYMS)
		.filter(([stem]) => matchesFamily(word, stem))
		.flatMap(([, values]) => values);
}

/** Both retrieval and ranking expand each normalized query token through this one path. */
function queryTerms(query: string): Map<string, readonly string[]> {
	return new Map(
		tokens(query)
			.filter((word) => !QUERY_STOP_WORDS.has(word))
			.map((word) => [word, [word, ...expansionsFor(word).map(normalize)]]),
	);
}

/** Only report tags present in the dataset and explicitly matched by the query. */
export function matchingTags(query: string, tags: readonly string[]): string[] {
	const wishes = new Set([...queryTerms(query).values()].flat());
	return [...new Set(tags)].filter((tag) => wishes.has(normalize(tag))).sort();
}

function partialMatch(word: string, field: ReadonlySet<string>): boolean {
	// Four characters avoid broad matches like вид → видео. Exact matches always win.
	return word.length >= 4 && [...field].some((value) => value.startsWith(word));
}

type SearchablePlace = Partial<Pick<Place, 'category' | 'description' | 'name' | 'nameEn' | 'tags'>> &
	Pick<Place, 'id'>;

export function lexicalScores(query: string, places: readonly SearchablePlace[]): Map<string, number> {
	const terms = queryTerms(query);
	const scores = new Map<string, number>();
	for (const place of places) {
		const name = new Set(tokens(`${place.name ?? ''} ${place.nameEn ?? ''}`));
		const description = new Set(tokens(place.description ?? ''));
		const metadata = new Set([normalize(place.category ?? ''), ...(place.tags ?? []).map(normalize)]);
		let sum = 0;
		for (const [word, alternatives] of terms) {
			const synonymMatch = alternatives.some((value) => metadata.has(value));
			if (name.has(word)) sum += 1;
			else if (metadata.has(word) || synonymMatch) sum += 0.8;
			else if (partialMatch(word, name)) sum += 0.65;
			else if (description.has(word)) sum += 0.5;
			else if (partialMatch(word, description)) sum += 0.3;
		}
		scores.set(place.id, terms.size ? sum / terms.size : 0);
	}
	return scores;
}
