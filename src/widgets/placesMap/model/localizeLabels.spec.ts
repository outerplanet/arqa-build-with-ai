import { describe, expect, it } from 'vitest';
import { cityLabelLayerIds, nameLabelLayerIds } from './localizeLabels';

describe('cityLabelLayerIds', () => {
	it('picks city and town name layers of both styles and nothing else', () => {
		const symbol = (id: string) => ({ id, type: 'symbol' });
		expect(
			cityLabelLayerIds([
				symbol('label_city_capital'),
				symbol('label_city'),
				symbol('label_town'),
				symbol('place_city_large'),
				symbol('place_suburb'),
				symbol('highway-name-major'),
				{ id: 'place_city_fill', type: 'fill' },
			]),
		).toEqual(['label_city_capital', 'label_city', 'label_town', 'place_city_large']);
	});
});

const LATIN = [
	'case',
	['has', 'name:nonlatin'],
	['concat', ['get', 'name:latin'], ' ', ['get', 'name:nonlatin']],
	['coalesce', ['get', 'name_en'], ['get', 'name']],
];

describe('nameLabelLayerIds', () => {
	it('picks street, water and city labels from the OpenFreeMap style and skips road shields', () => {
		expect(
			nameLabelLayerIds([
				{ id: 'water', type: 'fill' },
				{ id: 'highway-name-major', layout: { 'text-field': LATIN }, type: 'symbol' },
				{ id: 'waterway_line_label', layout: { 'text-field': LATIN }, type: 'symbol' },
				{ id: 'label_city', layout: { 'text-field': '{name:latin}\n{name:nonlatin}' }, type: 'symbol' },
				{ id: 'highway-shield-non-us', layout: { 'text-field': ['to-string', ['get', 'ref']] }, type: 'symbol' },
				{ id: 'poi-icon', layout: { 'icon-image': 'dot' }, type: 'symbol' },
			]),
		).toEqual(['highway-name-major', 'waterway_line_label', 'label_city']);
	});
});
