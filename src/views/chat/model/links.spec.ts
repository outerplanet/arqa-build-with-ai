import { describe, expect, it } from 'vitest';
import { safeHref, splitLinks } from './links';

describe('splitLinks', () => {
	it('turns an OpenStreetMap link into a link part', () => {
		expect(splitLinks('Источник места: [OpenStreetMap](https://www.openstreetmap.org/node/1).')).toEqual([
			{ kind: 'text', text: 'Источник места: ' },
			{ href: 'https://www.openstreetmap.org/node/1', kind: 'link', text: 'OpenStreetMap' },
			{ kind: 'text', text: '.' },
		]);
	});

	it('accepts Wikidata and several links in one line', () => {
		const parts = splitLinks('[OSM](https://openstreetmap.org/way/2) и [Wikidata](https://www.wikidata.org/wiki/Q1)');
		expect(parts.filter((part) => part.kind === 'link').map((part) => part.text)).toEqual(['OSM', 'Wikidata']);
	});

	it('shows a link to any other host as its label only', () => {
		expect(splitLinks('см. [сайт](https://evil.example/openstreetmap.org)')).toEqual([
			{ kind: 'text', text: 'см. сайт' },
		]);
	});

	it('rejects a lookalike host and non-http schemes', () => {
		expect(splitLinks('[a](https://openstreetmap.org.evil.example/x)')).toEqual([{ kind: 'text', text: 'a' }]);
		expect(splitLinks('[b](javascript:alert(1))').some((part) => part.kind === 'link')).toBe(false);
		expect(safeHref('ftp://openstreetmap.org/x')).toBeNull();
		expect(safeHref('не ссылка')).toBeNull();
	});

	it('leaves text without links untouched', () => {
		expect(splitLinks('Байтерек рядом')).toEqual([{ kind: 'text', text: 'Байтерек рядом' }]);
		expect(splitLinks('')).toEqual([]);
	});
});
