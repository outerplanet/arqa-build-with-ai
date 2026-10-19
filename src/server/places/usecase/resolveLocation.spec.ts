import { type Place } from '@server/places/model/places.schema';
import { readFileSync } from 'node:fs';
import 'server-only';
import { describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { type PlacesDependencies } from './dependencies';
import { AIRPORT_ALIASES, EXPO_ALIASES, LANDMARKS, mentions } from './landmarks';
import { resolveLocation } from './resolveLocation';

// Committed collection snapshot, not a network request or invented landmark coordinates.
const dataset = JSON.parse(readFileSync('data/poi.json', 'utf8')) as Place[];
function place(id: string): Place {
	const result = dataset.find((item) => item.id === id);
	if (!result) throw new Error(`Missing snapshot landmark ${id}`);
	return result;
}
function context(places: readonly Place[] = dataset): PlacesContext {
	return {
		now: new Date('2026-10-19T08:00:00Z'),
		places: { readPlaces: vi.fn(() => places) } as unknown as PlacesDependencies,
	};
}

describe('landmark resolution against the committed collection', () => {
	it.each(['Mega Silk Way', 'Мега Силк Вей'])('resolves duplicate mall representations: %s', (text) => {
		expect(resolveLocation(context(), { text })).toMatchObject({
			found: true,
			matchedPlaceId: 'osm:way/499328514',
			point: { lat: 51.089, lon: 71.407 },
		});
	});
	it.each(['Байтерек', 'Я у Байтерека', 'Baiterek', 'Бәйтерек'])(
		'selects the monument rather than a namesake: %s',
		(text) => {
			expect(resolveLocation(context(), { text })).toMatchObject({
				found: true,
				matchedPlaceId: 'osm:way/230401645',
			});
		},
	);
	it.each(['Нур Алем', 'Нұр Әлем', 'Nur Alem'])('does not substitute EXPO for the missing museum: %s', (text) => {
		const withoutMuseum = dataset.filter((item) => item.id !== 'osm:way/454857501');
		expect(resolveLocation(context(withoutMuseum), { text })).toMatchObject({ found: false, point: null });
	});
	it.each(['Нур Алем', 'Нұр Әлем', 'Nur Alem', 'Alem.ai', 'Alem.ai Международный центр искусственного интеллекта'])(
		'resolves the historical or current name to the confirmed OSM identity: %s',
		(text) => {
			const museum = place('osm:way/454857501');
			expect(resolveLocation(context(), { text })).toMatchObject({
				found: true,
				label: 'Alem.ai (бывший Нур Алем), территория ЭКСПО',
				matchedPlaceId: museum.id,
				point: { lat: 51.089, lon: 71.416 },
			});
		},
	);
	it('anchors the historical alias in the preserved OSM identity history', () => {
		const history = JSON.parse(readFileSync('data/nur-alem-history.json', 'utf8')) as {
			sourceUrl: string;
			versions: { id: number; tags: Record<string, string>; version: number }[];
		};
		expect(history.sourceUrl).toBe('https://api.openstreetmap.org/api/0.6/way/454857501/history.json');
		for (const version of [11, 12]) {
			expect(history.versions.find((item) => item.version === version)).toMatchObject({
				id: 454857501,
				tags: { 'name:ru': 'Музей Нур Алем' },
			});
		}
	});
	it('does not apply historical names to an object with another ID, category, source or current name', () => {
		const museum = place('osm:way/454857501');
		for (const wrong of [
			{ ...museum, id: 'osm:way/1' },
			{ ...museum, category: 'cafe' as const },
			{ ...museum, sourceUrl: 'https://www.openstreetmap.org/way/1' },
			{ ...museum, name: 'EXPO' },
		]) {
			expect(resolveLocation(context([wrong]), { text: 'Нур Алем' }).found).toBe(false);
			expect(resolveLocation(context([wrong]), { text: 'Alem.ai' }).found).toBe(false);
		}
	});
	it.each([
		'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
		'Я у здания Экспо 2017',
		'Я возле EXPO',
		'Я у Сферы Экспо',
		'Я у Экспо',
		'Я у Нур Алема',
		'Я у музея Нур Алем',
		'Я у Alem.ai',
		'Я у Нур Алем на Экспо',
	])('resolves the whole EXPO alias group to the single verified anchor: %s', (text) => {
		const museum = place('osm:way/454857501');
		expect(resolveLocation(context(), { text })).toMatchObject({
			found: true,
			label: 'Alem.ai (бывший Нур Алем), территория ЭКСПО',
			matchedPlaceId: museum.id,
			point: { lat: 51.089, lon: 71.416 },
		});
	});
	it('never anchors EXPO to the site or quarter outlines when the verified building is missing', () => {
		const withoutMuseum = dataset.filter((item) => item.id !== 'osm:way/454857501');
		for (const text of ['Я у Экспо 2017', 'Я возле EXPO']) {
			expect(resolveLocation(context(withoutMuseum), { text })).toMatchObject({ found: false, point: null });
		}
	});
	it('asks when another named dataset POI accompanies the landmark', () => {
		expect(
			resolveLocation(context(), { text: 'Я между Нур Алем и Национальный музей Республики Казахстан' }).found,
		).toBe(false);
	});
	it.each(['Я между Нур Алем и AITU', 'Я на станции Байтерек', 'Я между Байтереком и Хан Шатыром'])(
		'does not replace conflicting or typed locations with an anchor: %s',
		(text) => {
			expect(resolveLocation(context(), { text }).found).toBe(false);
		},
	);
	it.each([
		['Я у Байтерека', 'osm:way/230401645'],
		['Я возле Байтерека', 'osm:way/230401645'],
		['Я у Хан Шатыра', 'osm:way/460703779'],
		['Я возле Мега Силк Вея', 'osm:way/499328514'],
		['Я около Mega Silk Way', 'osm:way/499328514'],
	])('recognises Russian case forms: %s', (text, id) => {
		expect(resolveLocation(context(), { text })).toMatchObject({ found: true, matchedPlaceId: id });
	});
	it('matches case endings without false positives on unrelated words', () => {
		const at = (text: string) => LANDMARKS.filter((aliases) => aliases.some((alias) => mentions(text, alias)));
		expect(at('Иду от Ак Орды')).toHaveLength(1);
		expect(at('Я у Экспо')).toEqual([EXPO_ALIASES]);
		for (const text of ['Экспорт и экспертиза', 'Алтын орда', 'Хочу в бар Мега', 'Сфера услуг', 'Мегаполис']) {
			expect(at(text)).toEqual([]);
		}
	});
	it('treats being at the airport as a location but not travelling to it', () => {
		const airport = (text: string) => AIRPORT_ALIASES.some((alias) => mentions(text, alias));
		expect(airport('Я в аэропорту, рейс через 3 часа')).toBe(true);
		expect(airport('Я у аэропорта')).toBe(true);
		expect(airport('Еду в аэропорт')).toBe(false);
		expect(airport('У меня 2 часа перед вылетом')).toBe(false);
	});
	it('accepts the model excerpt of an inflected landmark as stated by the user', () => {
		const ctx = context();
		ctx.userMessages = ['Я у Байтерека, хочу гулять'];
		expect(resolveLocation(ctx, { text: 'Байтерек' }).matchedPlaceId).toBe('osm:way/230401645');
	});
	it('preserves genuine ambiguity between distinct malls and ignores input ordering', () => {
		const mall = place('osm:way/499328514');
		const second = { ...mall, id: 'osm:way/1', lat: mall.lat + 0.02 };
		for (const places of [
			[mall, second],
			[second, mall],
		]) {
			expect(resolveLocation(context(places), { text: 'Mega Silk Way' }).found).toBe(false);
		}
	});
	it('does not merge nearby unknown OSM identities', () => {
		const mall = place('osm:way/499328514');
		expect(resolveLocation(context([mall, { ...mall, id: 'osm:node/1' }]), { text: 'Mega Silk Way' }).found).toBe(
			false,
		);
	});
	it('requires the verified duplicate to remain nearby with matching category and name', () => {
		const mall = place('osm:way/499328514');
		const node = place('osm:node/4965336822');
		expect(resolveLocation(context([mall, { ...node, lat: node.lat + 0.02 }]), { text: 'Mega Silk Way' }).found).toBe(
			false,
		);
		expect(resolveLocation(context([mall, { ...node, category: 'cafe' }]), { text: 'Mega Silk Way' }).found).toBe(
			false,
		);
	});
	it('keeps two separate monuments ambiguous and refuses an unclassified namesake alone', () => {
		const monument = place('osm:way/230401645');
		expect(resolveLocation(context([monument, { ...monument, id: 'osm:node/2' }]), { text: 'Байтерек' }).found).toBe(
			false,
		);
		expect(resolveLocation(context([place('osm:way/1547354202')]), { text: 'Байтерек' }).found).toBe(false);
	});
	it('still requires the model location excerpt to have been stated by the user', () => {
		const ctx = context();
		ctx.userMessages = ['Хочу кофе'];
		expect(() => resolveLocation(ctx, { text: 'Mega Silk Way' })).toThrow();
		expect(ctx.places!.readPlaces).not.toHaveBeenCalled();
	});
});
