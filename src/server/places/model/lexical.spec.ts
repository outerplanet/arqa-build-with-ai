import 'server-only';
import { describe, expect, it } from 'vitest';
import { lexicalScores, matchingTags } from './lexical';
import { type Place } from './places.schema';

const FIELDS = [
	{
		category: 'cafe',
		description: 'Тихая кофейня',
		id: 'coffee',
		name: 'Кофе',
		nameEn: 'Coffee',
		tags: ['power_sockets'],
	},
	{ category: 'playground', description: null, id: 'kids', name: 'Детская площадка', nameEn: null, tags: ['kids'] },
	{ category: 'viewpoint', description: 'Красивый вид', id: 'view', name: 'Орёл', nameEn: null, tags: ['view'] },
	{ category: 'bar', description: null, id: 'night', name: 'Бар', nameEn: null, tags: ['night'] },
] satisfies Pick<Place, 'category' | 'description' | 'id' | 'name' | 'nameEn' | 'tags'>[];

const PLACES: Place[] = FIELDS.map((place, index) => ({
	address: null,
	descriptionSource: null,
	lat: 51.1,
	lon: 71.4,
	openingHours: null,
	phone: null,
	popularity: null,
	sourceUrl: `https://www.openstreetmap.org/node/${index + 1}`,
	website: null,
	wheelchair: null,
	...place,
}));

describe('shared query tag matching', () => {
	it.each([
		['Wi-Fi', 'wifi'],
		['вай-фай', 'wifi'],
		['интернет', 'wifi'],
		['терраса', 'outdoor_seating'],
		['веранда', 'outdoor_seating'],
		['бесплатно', 'free'],
		['тегін', 'free'],
		['коляской', 'wheelchair'],
		['розетками', 'power_sockets'],
		['ребёнком', 'kids'],
		['балалар', 'kids'],
		['ТҮНГІ', 'night'],
		['СМОТРОВАЯ', 'view'],
		['WiFi', 'wifi'],
	])('uses identical tag terms in lexical retrieval and matching: %s', (query, tag) => {
		const tagged = {
			...PLACES[0]!,
			category: 'other' as const,
			description: null,
			name: 'Тест',
			nameEn: null,
			tags: [tag],
		};
		expect(matchingTags(query, tagged.tags)).toEqual([tag]);
		expect(lexicalScores(query, [tagged]).get(tagged.id)).toBe(0.8);
	});
	it.each(['', '  ', '?!', 'Я хочу', 'детектив', 'видео'])('does not invent tags for %j', (query) => {
		expect(matchingTags(query, ['kids', 'power_sockets', 'view', 'wifi'])).toEqual([]);
	});
	it('returns only existing tags, deduplicates them and never mutates the input', () => {
		const tags = Object.freeze(['wifi', 'power_sockets', 'kids', 'power_sockets']);
		expect(matchingTags('РЕБЁНКОМ, розетками розетками', tags)).toEqual(['kids', 'power_sockets']);
		expect(matchingTags('розетка', [])).toEqual([]);
		expect(tags).toEqual(['wifi', 'power_sockets', 'kids', 'power_sockets']);
	});
});

describe('lexical retrieval without a provider', () => {
	it('keeps conversational framing from diluting a specific category request', () => {
		const places = [{ ...PLACES[0]!, category: 'museum' as const, id: 'museum', name: 'Тестовый музей' }];
		expect(lexicalScores('Хочу сходить в музей рядом со мной', places)).toEqual(lexicalScores('музей', places));
		expect(lexicalScores('Пожалуйста, найди мне кофе недалеко от меня', PLACES)).toEqual(
			lexicalScores('кофе', PLACES),
		);
	});
	it.each(['прогулка', 'прогуляться', 'маршрут', 'серуен'])(
		'retrieves outdoor walk categories for %s without inferring facilities',
		(query) => {
			const park = { ...PLACES[0]!, category: 'park' as const, id: 'park', name: 'Тестовый сквер', tags: [] };
			const scores = lexicalScores(query, [...PLACES, park]);
			expect(scores.get('park')).toBeGreaterThan(scores.get('coffee')!);
			expect(matchingTags(query, ['kids', 'power_sockets', 'wifi'])).toEqual([]);
		},
	);
	it.each([
		['кофейн', 'coffee'],
		['МҰРАЖАЙ', 'museum'],
		['балалар', 'kids'],
		['кофе', 'coffee'],
	])('retrieves Russian prefixes and Kazakh categories: %s', (query, id) => {
		const places = [...PLACES, { ...PLACES[0]!, category: 'museum' as const, id: 'museum', name: 'Тест' }];
		expect(lexicalScores(query, places).get(id)).toBeGreaterThan(0);
	});
	it('matches Kazakh names, Unicode normalization and repeated whitespace deterministically', () => {
		const places = [{ ...PLACES[0]!, name: 'Бәйтерек — саябақ', nameEn: null }];
		const expected = lexicalScores('Бәйтерек саябақ', places);
		expect(lexicalScores('  БӘЙТЕРЕК,   САЯБАҚ! ', places)).toEqual(expected);
		expect(lexicalScores('Бәйтерек саябақ'.normalize('NFD'), places)).toEqual(expected);
	});
	it('weights exact names above descriptions and tolerates absent optional metadata', () => {
		const places = [PLACES[0]!, { ...PLACES[0]!, description: 'Кофе', id: 'description', name: 'Тест' }];
		const scores = lexicalScores('кофе', places);
		expect(scores.get('coffee')).toBeGreaterThan(scores.get('description')!);
		const incomplete = { ...PLACES[0]!, description: undefined, tags: undefined } as unknown as Place;
		expect(lexicalScores('кофе', [incomplete]).get('coffee')).toBe(1);
	});
	it('handles empty queries and empty datasets', () => {
		expect([...lexicalScores('', PLACES).values()]).toEqual([0, 0, 0, 0]);
		expect(lexicalScores('кофе', []).size).toBe(0);
		expect([...lexicalScores('Я хочу', PLACES).values()]).toEqual([0, 0, 0, 0]);
	});
	it('normalises case, punctuation, ё and simple endings', () => {
		expect(lexicalScores('ОРЕЛ!', PLACES).get('view')).toBe(1);
		expect(lexicalScores('розетками', PLACES).get('coffee')).toBeGreaterThan(0);
		expect(lexicalScores('Coffee', PLACES).get('coffee')).toBe(1);
	});
	it.each([
		['кофе', 'coffee'],
		['дети', 'kids'],
		['ребёнком', 'kids'],
		['ночной', 'night'],
		['смотровая', 'view'],
		['тихо', 'coffee'],
		['розетка', 'coffee'],
	])('expands %s into matching categories or tags', (query, id) => {
		expect(lexicalScores(query, PLACES).get(id)).toBeGreaterThan(0);
	});
	it('rewards matching multiple wishes and ignores repeated words', () => {
		const scores = lexicalScores('тихо кофе розетка', PLACES);
		expect(scores.get('coffee')).toBeGreaterThan(scores.get('kids')!);
		expect(lexicalScores('кофе кофе', PLACES)).toEqual(lexicalScores('кофе', PLACES));
	});
	it('does not treat unrelated words sharing a prefix as synonyms', () => {
		expect(lexicalScores('видео', PLACES).get('view')).toBe(0);
		expect(lexicalScores('детектив', PLACES).get('kids')).toBe(0);
		expect(lexicalScores('детали', PLACES).get('kids')).toBe(0);
	});
	it('keeps unrelated places at zero and scores within the contract bounds', () => {
		const scores = lexicalScores('неизвестно', PLACES);
		expect([...scores.values()]).toEqual([0, 0, 0, 0]);
		for (const score of lexicalScores('тихо кофе', PLACES).values()) {
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		}
	});
});
