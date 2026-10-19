import { describe, expect, it } from 'vitest';
import { twoGisUrl, yandexMapsUrl } from './mapLinks';

const point = { lat: 51.089, lon: 71.416 };

describe('external map links', () => {
	it('builds a 2GIS Astana search centred on the place, longitude first', () => {
		expect(twoGisUrl('Alem.ai', point)).toBe('https://2gis.kz/astana/search/Alem.ai?m=71.41600%2C51.08900%2F17');
	});

	it('encodes a Cyrillic or slash-containing name so it stays one path segment', () => {
		const url = new URL(twoGisUrl('Байтерек / Bayterek', point));
		expect(url.pathname.split('/')).toHaveLength(4);
		expect(decodeURIComponent(url.pathname.split('/')[3]!)).toBe('Байтерек / Bayterek');
	});

	it('builds a Yandex Maps search with text, centre and zoom', () => {
		const url = new URL(yandexMapsUrl('Кофейня «Утро»', point));
		expect(url.origin + url.pathname).toBe('https://yandex.kz/maps/');
		expect(url.searchParams.get('text')).toBe('Кофейня «Утро»');
		expect(url.searchParams.get('ll')).toBe('71.41600,51.08900');
		expect(url.searchParams.get('z')).toBe('17');
	});
});
