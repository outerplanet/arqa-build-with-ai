import 'server-only';

/** Aliases, not a second POI database: coordinates and sources always come from the dataset. */
export const EXPO_ALIASES = [
	'экспо',
	'expo',
	'экспо 2017',
	'expo 2017',
	'сфера экспо',
	'сфера expo',
	'шар экспо',
] as const;
export const NUR_ALEM_ALIASES = ['нур алем', 'нұр әлем', 'нұр алем', 'нур әлем', 'nur alem'] as const;
export const ALEM_AI_ALIASES = ['alem.ai', 'alem.ai международный центр искусственного интеллекта'] as const;
export const BAYTEREK_ALIASES = ['байтерек', 'байтерека', 'бәйтерек', 'baiterek', 'bayterek'] as const;
export const MEGA_ALIASES = ['mega silk way', 'mega silkway astana', 'мега силк вей', 'мега шелковый путь'] as const;
/**
 * Travelling TO the airport ("еду в аэропорт", "перед вылетом") is not a starting point, so only
 * phrases that place the user AT the airport count, and they are matched literally (no stemming).
 */
export const AIRPORT_ALIASES = [
	'в аэропорту',
	'у аэропорта',
	'возле аэропорта',
	'около аэропорта',
	'рядом с аэропортом',
	'нурсултан назарбаев',
	'nursultan nazarbayev international airport',
	'at the airport',
] as const;

export const LANDMARKS: readonly (readonly string[])[] = [
	EXPO_ALIASES,
	NUR_ALEM_ALIASES,
	ALEM_AI_ALIASES,
	BAYTEREK_ALIASES,
	['хан шатыр', 'khan shatyr'],
	MEGA_ALIASES,
	['нурлы жол', 'нұрлы жол', 'nurly zhol'],
	['астана 1', 'astana 1'],
	AIRPORT_ALIASES,
	['ак орда', 'ақорда', 'ak orda', 'akorda'],
	['дворец мира и согласия', 'бейбітшілік және келісім сарайы', 'palace of peace and reconciliation'],
	['ену', 'enu', 'евразийский национальный университет'],
	['aitu', 'astana it university', 'астана ит университет'],
];

/** Spelling variants users type for the same name: «Байтэрек», «Бәйтерек», «Мечеть»/«Мечет». */
const FOLD: Readonly<Record<string, string>> = {
	ә: 'а',
	ғ: 'г',
	ё: 'е',
	і: 'и',
	қ: 'к',
	ң: 'н',
	ө: 'о',
	ү: 'у',
	ұ: 'у',
	һ: 'х',
	э: 'е',
};

export function normalizeLocation(text: string): string {
	return text
		.toLocaleLowerCase('ru')
		.replaceAll(/[ёғқңүұһіәөэ]/gu, (letter) => FOLD[letter] ?? letter)
		.replaceAll(/[ъь]/gu, '')
		.replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

const LITERAL = new Set<string>(AIRPORT_ALIASES.map(normalizeLocation));
const CYRILLIC_WORD = /^\p{Script=Cyrillic}+$/u;

function escape(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Russian case endings: "у Байтерека", "от Ак Орды", "возле Мега Силк Вея", "у Нур Алема".
 * A Cyrillic word of 4+ letters (or the last word of a multiword name, 3+ letters) drops one
 * final vowel and accepts up to two Cyrillic letters. Shorter words, Latin and digits are exact,
 * and the whole name still has to occupy whole words, so "экспорт" never matches "экспо".
 */
function wordPattern(word: string, endOfMultiword: boolean): string {
	if (!CYRILLIC_WORD.test(word) || (word.length < 4 && !(endOfMultiword && word.length >= 3))) {
		return escape(word);
	}
	return `${escape(word.replace(/[аяоеиыйьуә]$/u, ''))}\\p{Script=Cyrillic}{0,2}`;
}

/** Matches against ` ${normalizeLocation(text)} ` and never consumes the surrounding spaces. */
export function namePattern(name: string, flags = 'u'): RegExp {
	const normalized = normalizeLocation(name);
	const words = normalized.split(' ').filter(Boolean);
	const body = LITERAL.has(normalized)
		? escape(normalized)
		: words.map((word, index) => wordPattern(word, words.length > 1 && index === words.length - 1)).join(' ');
	return new RegExp(`(?<= )${body}(?= )`, flags);
}

/** Landmark aliases and user excerpts: whole words, tolerant of Russian case endings. */
export function mentions(text: string, name: string): boolean {
	if (!normalizeLocation(name)) return false;
	return namePattern(name).test(` ${normalizeLocation(text)} `);
}

/** Dataset POI names: whole words, exact form (no stemming against 1000+ arbitrary names). */
export function mentionsExact(text: string, name: string): boolean {
	const normalized = normalizeLocation(name);
	return normalized !== '' && ` ${normalizeLocation(text)} `.includes(` ${normalized} `);
}

/** Words that name a kind of place, not a place: «у детской площадки» is not a landmark. */
const GENERIC_WORDS = new Set(
	[
		'детская',
		'площадка',
		'улица',
		'проспект',
		'парк',
		'сквер',
		'кафе',
		'ресторан',
		'магазин',
		'центр',
		'торговый',
		'astana',
		'астана',
		'казахстан',
		'республика',
		'республики',
		'kazakhstan',
	].map(normalizeLocation),
);

function significant(word: string): boolean {
	return word.length >= 4 && !GENERIC_WORDS.has(word);
}

/**
 * Russian adjective and noun case endings for dataset names: «Триумфальной арки», «Национального
 * музея», «Ботанического сада». A Cyrillic word drops one final vowel (two in words of 6+ letters,
 * keeping a 3-letter stem) and accepts up to three Cyrillic letters. Latin, digits and words of
 * one or two letters are exact.
 */
function datasetWordPattern(word: string): string {
	if (!CYRILLIC_WORD.test(word) || word.length < 3) return escape(word);
	let stem = word;
	const maxStrip = word.length >= 6 ? 2 : 1;
	while (word.length - stem.length < maxStrip && stem.length > 3 && /[аяоеиыйу]$/u.test(stem)) {
		stem = stem.slice(0, -1);
	}
	return `${escape(stem)}\\p{Script=Cyrillic}{0,3}`;
}

function containsWords(normalizedText: string, words: readonly string[]): boolean {
	return new RegExp(`(?<= )${words.map(datasetWordPattern).join(' ')}(?= )`, 'u').test(` ${normalizedText} `);
}

/**
 * How strongly the user's words name a dataset POI: 3 — the whole name (inflection tolerated),
 * 2 — a contiguous prefix of at least two words with a significant word, 1 — every significant
 * word of a name that has at least two of them, 0 — no match. Single-word names only match exactly:
 * «Мост», «Вечер» and similar venues are ordinary words too.
 */
export function datasetNameStrength(text: string, name: string): number {
	const words = normalizeLocation(name).split(' ').filter(Boolean);
	if (words.length === 0) return 0;
	const normalizedText = normalizeLocation(text);
	if (mentionsExact(normalizedText, name)) return 3;
	if (words.length === 1) return 0;
	for (let { length } = words; length >= 2; length--) {
		const prefix = words.slice(0, length);
		if (prefix.some(significant) && containsWords(normalizedText, prefix)) return length === words.length ? 3 : 2;
	}
	const keys = words.filter(significant);
	return keys.length >= 2 && keys.every((word) => containsWords(normalizedText, [word])) ? 1 : 0;
}

const PREPOSITION = String.raw`(?:возле|около|рядом\s+со?|недалеко\s+от|напротив|у|на|в|во|near|at)`;
const STOP_WORDS = new Set(
	['хочу', 'хотим', 'хотел', 'хотела', 'ищу', 'ищем', 'подскажи', 'подскажите', 'посоветуй', 'посоветуйте'].concat([
		'где',
		'что',
		'куда',
		'можно',
		'есть',
		'сейчас',
		'уже',
		'пешком',
		'буду',
		'будем',
	]),
);
/** «Дворец мира и согласия» keeps its «и»; only a dangling conjunction is dropped. */
const TRAILING = new Set(['а', 'и', 'но']);

/** The words the user used for the place («набережной», «Ак Орды»), kept as typed for the reply. */
export function locationPhrase(text: string): string | null {
	const place = String.raw`${PREPOSITION}\s+([^,.!?;:()\n—–…]+)`;
	const subject = String.raw`(?:я|мы|нахожусь|находимся|стою|сейчас)(?:\s+(?:сейчас|прямо|тут))*\s+`;
	const found =
		new RegExp(String.raw`(?:^|[^\p{L}])${subject}${place}`, 'iu').exec(text) ??
		new RegExp(String.raw`(?:^|[^\p{L}])${place}`, 'iu').exec(text);
	const words = (found?.[1] ?? text).trim().split(/\s+/u);
	const end = words.findIndex((word, index) => index > 0 && STOP_WORDS.has(word.toLocaleLowerCase('ru')));
	const phrase = words.slice(0, end === -1 ? 5 : Math.min(end, 5));
	while (phrase.length > 1 && TRAILING.has(phrase.at(-1)!.toLocaleLowerCase('ru'))) phrase.pop();
	const result = phrase.join(' ').trim();
	return result === '' ? null : result;
}
