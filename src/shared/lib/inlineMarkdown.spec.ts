import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown } from './inlineMarkdown';

describe('parseInlineMarkdown', () => {
	it('leaves plain text as one plain segment', () => {
		expect(parseInlineMarkdown('Байтерек рядом')).toEqual([
			{ heading: false, segments: [{ bold: false, text: 'Байтерек рядом' }] },
		]);
	});

	it('turns **bold** into a bold segment between plain ones', () => {
		expect(parseInlineMarkdown('Идите в **Байтерек** сейчас')[0]?.segments).toEqual([
			{ bold: false, text: 'Идите в ' },
			{ bold: true, text: 'Байтерек' },
			{ bold: false, text: ' сейчас' },
		]);
	});

	it('handles several bold runs on one line', () => {
		const segments = parseInlineMarkdown('**a** и **b**')[0]?.segments;

		expect(segments).toEqual([
			{ bold: true, text: 'a' },
			{ bold: false, text: ' и ' },
			{ bold: true, text: 'b' },
		]);
	});

	it.each(['# Маршрут', '## Маршрут', '### Маршрут'])('makes "%s" a heading without the hashes', (line) => {
		expect(parseInlineMarkdown(line)).toEqual([{ heading: true, segments: [{ bold: false, text: 'Маршрут' }] }]);
	});

	it('does not treat four hashes or a hash without a space as a heading', () => {
		expect(parseInlineMarkdown('#### four')[0]?.heading).toBe(false);
		expect(parseInlineMarkdown('#hashtag')[0]?.heading).toBe(false);
	});

	it('strips single backticks around inline code', () => {
		expect(parseInlineMarkdown('call `get_current_time` now')[0]?.segments).toEqual([
			{ bold: false, text: 'call get_current_time now' },
		]);
	});

	it('keeps one entry per line, including blank ones', () => {
		const lines = parseInlineMarkdown('one\n\ntwo');

		expect(lines).toHaveLength(3);
		expect(lines[1]?.segments).toEqual([]);
	});

	it('leaves an unclosed ** as literal text', () => {
		expect(parseInlineMarkdown('2 ** 3')[0]?.segments).toEqual([{ bold: false, text: '2 ** 3' }]);
	});

	it('never produces markup: angle brackets stay as text for React to escape', () => {
		expect(parseInlineMarkdown('**<script>**')[0]?.segments).toEqual([{ bold: true, text: '<script>' }]);
	});
});
