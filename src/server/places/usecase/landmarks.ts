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
export const BAYTEREK_ALIASES = ['байтерек', 'бәйтерек', 'baiterek', 'bayterek'] as const;
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

export function normalizeLocation(text: string): string {
	return text
		.toLocaleLowerCase('ru')
		.replaceAll('ё', 'е')
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
