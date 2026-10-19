import { type Place } from '@server/places/model/places.schema';
import { readFileSync } from 'node:fs';
import 'server-only';
import { describe, expect, it, vi } from 'vitest';
import { type PlacesContext } from './context';
import { type PlacesDependencies } from './dependencies';
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
	it.each(['Байтерек', 'Baiterek', 'Бәйтерек'])('selects the monument rather than a namesake: %s', (text) => {
		expect(resolveLocation(context(), { text })).toMatchObject({
			found: true,
			matchedPlaceId: 'osm:way/230401645',
		});
	});
	it.each(['Нур Алем', 'Нұр Әлем', 'Nur Alem'])('does not substitute EXPO for the missing museum: %s', (text) => {
		expect(resolveLocation(context(), { text })).toMatchObject({ found: false, point: null });
	});
	it('still resolves the actual generic EXPO object when the user names EXPO', () => {
		expect(resolveLocation(context(), { text: 'Я у Экспо 2017' })).toMatchObject({
			found: true,
			matchedPlaceId: 'osm:way/454853233',
		});
	});
	it('resolves EXPO to the museum when available, but preserves distinct EXPO ambiguity', () => {
		const expo = place('osm:way/454853233');
		const museum: Place = { ...expo, category: 'museum', id: 'osm:node/1', name: 'Нұр Әлем' };
		expect(resolveLocation(context([museum]), { text: 'Я у Экспо' }).matchedPlaceId).toBe(museum.id);
		expect(resolveLocation(context([expo, museum]), { text: 'Я у Экспо' }).found).toBe(false);
		expect(resolveLocation(context([expo, museum]), { text: 'Я у Нур Алем на Экспо' }).matchedPlaceId).toBe(
			museum.id,
		);
		expect(resolveLocation(context([expo]), { text: 'Я у Нур Алем на Экспо' }).found).toBe(false);
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
