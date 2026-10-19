import 'server-only';
import { describe, expect, it } from 'vitest';
import { lexicalScores } from './lexical';
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

describe('lexical retrieval without a provider', () => {
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
