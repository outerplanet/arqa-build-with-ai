import 'server-only';
import { describe, expect, it } from 'vitest';
import { candidateSchema, type Place } from './places.schema';
import { isGenericName, isNotable, type RankInput, rankPlaces } from './rank';

function place(id: string, extra: Partial<Place> = {}): Place {
	return {
		address: null,
		category: 'cafe',
		description: null,
		descriptionSource: null,
		id,
		lat: 51.128,
		lon: 71.43,
		name: id,
		nameEn: null,
		openingHours: '24/7',
		phone: null,
		popularity: null,
		sourceUrl: 'https://www.openstreetmap.org/node/1',
		tags: ['wifi'],
		website: null,
		wheelchair: 'yes' as const,
		...extra,
	};
}

function input(places: ReturnType<typeof place>[], extra: Partial<RankInput> = {}): RankInput {
	return {
		at: new Date('2026-10-19T07:00:00Z'),
		limit: 20,
		maxWalkMinutes: 15,
		origin: { lat: 51.128, lon: 71.43 },
		places,
		semantic: new Map(),
		...extra,
	};
}

describe('rankPlaces', () => {
	it('puts a named sight above a generic-named square for a sightseer, and only for one', () => {
		const square = place('square', { category: 'park', name: 'Сквер', openingHours: null, tags: [] });
		const monument = place('monument', {
			category: 'monument',
			lat: 51.131,
			name: 'Табун Лошадей',
			openingHours: null,
			tags: [],
		});
		const semantic = new Map([
			['monument', 0.6],
			['square', 0.8],
		]);
		const ordinary = rankPlaces(input([square, monument], { semantic }));
		const sightseeing = rankPlaces(input([square, monument], { preferNotable: true, semantic }));

		expect(ordinary[0]!.place.id).toBe('square');
		expect(sightseeing.map((candidate) => candidate.place.id)).toEqual(['monument', 'square']);
		expect(isGenericName('  СКВЕР ')).toBe(true);
		expect(isNotable(square)).toBe(false);
		expect(isNotable(monument)).toBe(true);
	});

	it('does not let several cafes push the only park out of a short list', () => {
		const cafes = ['c1', 'c2', 'c3', 'c4'].map((id) => place(id, { name: `Кафе ${id}` }));
		const park = place('park', { category: 'park', name: 'NU Park', openingHours: null, tags: [] });
		const semantic = new Map([...cafes.map((cafe) => [cafe.id, 0.5] as const), ['park', 0.2]]);
		const ranked = rankPlaces(input([...cafes, park], { limit: 3, semantic }));

		expect(ranked.map((candidate) => candidate.place.id)).toContain('park');
		expect(ranked[0]!.place.category).toBe('cafe');
		// Diversity reorders; it never rewrites a candidate's own score.
		expect(ranked.find((candidate) => candidate.place.id === 'c2')?.score).toBe(
			rankPlaces(input(cafes, { semantic }))[1]!.score,
		);
	});

	it('adds a bounded tag bonus only for a matching internal query', () => {
		const original = place('a', { tags: ['kids', 'power_sockets', 'wifi'] });
		const base = input([original], { semantic: new Map([['a', 0.6]]) });
		const withoutQuery = rankPlaces(base)[0]!;
		for (const query of ['', '  ', '?!', 'галактика']) {
			expect(rankPlaces({ ...base, query })[0]).toEqual(withoutQuery);
		}
		const matched = rankPlaces({ ...base, query: 'розетка розетка ребёнок' })[0]!;
		expect(matched.why.tags).toEqual(['kids', 'power_sockets']);
		expect(matched.score - withoutQuery.score).toBeCloseTo(0.1);
		expect(matched.why.semantic).toBe(withoutQuery.why.semantic);
		expect(matched.place).toBe(original);
	});
	it('uses shared query tag matching with or without supplied relevance scores', () => {
		const places = [place('coffee', { name: 'Кофе', tags: ['power_sockets'] }), place('bar', { category: 'bar' })];
		for (const semantic of [
			new Map<string, number>(),
			new Map([
				['bar', 0.5],
				['coffee', 0.5],
			]),
		]) {
			const result = rankPlaces(input(places, { query: 'кофе розетка', semantic }));
			expect(result[0]!.place.id).toBe('coffee');
			expect(result[0]!.why.tags).toEqual(['power_sockets']);
			expect(result[1]!.why.tags).toEqual([]);
			expect(result[0]!.why.semantic).toBe(semantic.get('coffee') ?? 0);
			expect(result[1]!.why.semantic).toBe(semantic.get('bar') ?? 0);
		}
	});
	it('applies an optional total time budget independently of the walking radius', () => {
		const places = [place('museum', { category: 'museum' }), place('cafe')];
		expect(rankPlaces(input(places, { durationMinutes: 30 })).map((entry) => entry.place.id)).toEqual(['cafe']);
		expect(rankPlaces(input(places, { durationMinutes: 29 }))).toEqual([]);
	});
	it.each(['2026-10-19T22:00:00+05:00', '2026-10-20T01:00:00+05:00', '2026-10-20T05:59:00+05:00'])(
		'only returns verified open places at night: %s',
		(at) => {
			const places = [
				place('unknown', { openingHours: null }),
				place('closed', { openingHours: 'off' }),
				place('open'),
			];
			expect(rankPlaces(input(places, { at: new Date(at) })).map((entry) => entry.place.id)).toEqual(['open']);
		},
	);
	it('prefers relevant places and then nearby places when other signals tie', () => {
		const places = [place('near'), place('far', { lon: 71.435 })];
		expect(rankPlaces(input(places)).map((entry) => entry.place.id)).toEqual(['near', 'far']);
		expect(rankPlaces(input(places, { semantic: new Map([['far', 1]]) }))[0]!.place.id).toBe('far');
	});
	it('rejects invalid coordinates, invalid instants and invalid numeric bounds', () => {
		expect(rankPlaces(input([place('bad', { lon: 181 })]))).toEqual([]);
		expect(rankPlaces(input([place('a')], { origin: { lat: 91, lon: 71.43 } }))).toEqual([]);
		expect(rankPlaces(input([place('a')], { at: new Date(NaN) }))).toEqual([]);
		for (const value of [NaN, Infinity, -1]) {
			expect(rankPlaces(input([place('a')], { limit: value }))).toEqual([]);
			expect(rankPlaces(input([place('a')], { maxWalkMinutes: value }))).toEqual([]);
		}
	});
	it('returns candidates accepted by the shared contract', () => {
		const result = rankPlaces(input([place('osm:node/1')]));
		expect(() => candidateSchema.array().parse(result)).not.toThrow();
	});
	it('handles empty input and applies limits without changing source order', () => {
		expect(rankPlaces(input([]))).toEqual([]);
		const places = [place('b'), place('a')];
		expect(rankPlaces(input(places, { limit: 1 })).map((candidate) => candidate.place.id)).toEqual(['a']);
		expect(places.map((entry) => entry.id)).toEqual(['b', 'a']);
		expect(rankPlaces(input(places, { limit: 0 }))).toEqual([]);
	});

	it('uses the documented weighted signals without inventing tag matches', () => {
		const result = rankPlaces(input([place('a', { popularity: 0.6 })], { semantic: new Map([['a', 0.8]]) }));
		expect(result[0]!.score).toBeCloseTo(0.4 * 0.8 + 0.25 + 0.15 + 0.1 * 0.6);
		expect(result[0]!.why).toEqual({ distance: 1, open: 1, popularity: 0.6, semantic: 0.8, tags: [] });
	});

	it('keeps unknown hours and puts closed places last even with stronger relevance', () => {
		const result = rankPlaces(
			input(
				[
					place('closed', { openingHours: 'off', popularity: 1 }),
					place('unknown', { openingHours: null }),
					place('open'),
				],
				{ semantic: new Map([['closed', 1]]) },
			),
		);
		expect(result.map((candidate) => candidate.place.id)).toEqual(['open', 'unknown', 'closed']);
		expect(result[1]!.open.status).toBe('unknown');
		expect(rankPlaces(input([place('a', { openingHours: 'off' })]))[0]!.open.status).toBe('closed');
	});

	it('filters radius, category and confirmed wheelchair accessibility', () => {
		const places = [
			place('yes'),
			place('limited', { wheelchair: 'limited' }),
			place('unknown', { wheelchair: null }),
			place('no', { wheelchair: 'no' }),
			place('museum', { category: 'museum' }),
			place('far', { lat: 52 }),
		];
		expect(
			rankPlaces(input(places, { accessibleOnly: true, categories: ['cafe'] })).map((entry) => entry.place.id),
		).toEqual(['yes']);
	});

	it('includes the walking boundary and assigns category visit times', () => {
		const places = [place('museum', { category: 'museum', lon: 71.435 }), place('view', { category: 'viewpoint' })];
		const boundary = rankPlaces(input(places))[0]!.walkMinutes;
		const museum = rankPlaces(input([places[0]!]))[0]!;
		expect(rankPlaces(input([places[0]!], { maxWalkMinutes: museum.walkMinutes }))).toHaveLength(1);
		expect(rankPlaces(input([places[0]!], { maxWalkMinutes: museum.walkMinutes - 1 }))).toHaveLength(0);
		expect(museum.visitMinutes).toBe(60);
		expect(rankPlaces(input(places)).find((entry) => entry.place.id === 'view')!.visitMinutes).toBe(20);
		expect(boundary).toBe(0);
	});

	it('keeps only the best branch of a chain by normalised name, before the limit', () => {
		const places = [
			place('kfc-near', { name: 'KFC' }),
			place('kfc-far', { lon: 71.433, name: 'kfc ' }),
			place('kfc-closed', { name: 'K.F.C', openingHours: 'off' }),
			place('boom-1', { name: 'Coffee Boom', popularity: 0.5 }),
			place('boom-2', { name: 'COFFEE  BOOM' }),
			place('yolka', { name: 'Ёлка' }),
			place('elka', { lon: 71.432, name: 'Елка' }),
			place('other', { lon: 71.434, name: 'Другое место' }),
		];
		const result = rankPlaces(input(places, { limit: 4 }));
		expect(result.map((entry) => entry.place.id)).toEqual(['boom-1', 'kfc-near', 'yolka', 'other']);
		expect(rankPlaces(input(places, { semantic: new Map([['kfc-far', 1]]) }))[0]!.place.id).toBe('kfc-far');
	});
	it('demotes generic category names slightly without removing them', () => {
		const generic = ['Кофейня', 'Столовая', 'Сквер', 'Кафе', 'Парк', ' кафе! '];
		for (const name of generic) {
			const result = rankPlaces(input([place('generic', { name }), place('named', { name: 'Ракушка' })]));
			expect(result.map((entry) => entry.place.id)).toEqual(['named', 'generic']);
			expect(result[0]!.score - result[1]!.score).toBeGreaterThan(0);
			expect(result[0]!.score - result[1]!.score).toBeLessThanOrEqual(0.1);
		}
		const relevant = rankPlaces(
			input([place('generic', { name: 'Сквер' }), place('named', { name: 'Ракушка' })], {
				semantic: new Map([['generic', 0.5]]),
			}),
		);
		expect(relevant[0]!.place.id).toBe('generic');
		const edge = place('edge', { lon: 71.435, name: 'Кафе', openingHours: 'off' });
		const { walkMinutes } = rankPlaces(input([edge]))[0]!;
		expect(rankPlaces(input([edge], { maxWalkMinutes: walkMinutes }))[0]!.score).toBe(0);
	});
	it('clamps nonfinite and out-of-range signals and preserves full Place fields', () => {
		for (const value of [NaN, Infinity, -2, 2]) {
			const original = place('a', { popularity: value });
			const candidate = rankPlaces({ ...input([]), places: [original], semantic: new Map([['a', value]]) })[0]!;
			expect(Number.isFinite(candidate.score)).toBe(true);
			expect(candidate.score).toBeGreaterThanOrEqual(0);
			expect(candidate.score).toBeLessThanOrEqual(1);
			expect(candidate.place.sourceUrl).toBe(original.sourceUrl);
			expect(candidate.place).toBe(original);
		}
	});
});
