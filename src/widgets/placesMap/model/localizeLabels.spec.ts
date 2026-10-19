import { describe, expect, it } from 'vitest';
import { nameLabelLayerIds } from './localizeLabels';

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
