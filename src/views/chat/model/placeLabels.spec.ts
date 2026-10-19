import { type Place } from '@server/places/model/places.schema';
import { describe, expect, it } from 'vitest';
import { commonsImage, formatDistance } from './placeLabels';

const image = {
	author: 'A. Author',
	license: 'CC BY-SA 4.0',
	pageUrl: 'https://commons.wikimedia.org/wiki/File:Bayterek.jpg',
	url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Bayterek.jpg',
};
const withImage = (value: Place['image']) => ({ image: value }) as Place;

describe('commonsImage', () => {
	it('accepts a Commons file with its Commons page', () => {
		expect(commonsImage(withImage(image))).toEqual(image);
	});

	it('falls back to the tile for a missing image or any other host', () => {
		expect(commonsImage(withImage(null))).toBeNull();
		expect(commonsImage(withImage(undefined))).toBeNull();
		expect(commonsImage(withImage({ ...image, url: 'https://evil.example/wikipedia/commons/x.jpg' }))).toBeNull();
		expect(
			commonsImage(withImage({ ...image, url: 'http://upload.wikimedia.org/wikipedia/commons/x.jpg' })),
		).toBeNull();
		expect(commonsImage(withImage({ ...image, pageUrl: 'https://wikimedia.org.evil.example/x' }))).toBeNull();
	});
});

describe('formatDistance', () => {
	it('uses metres below a kilometre and a Russian decimal comma above', () => {
		expect(formatDistance(562.4)).toBe('562 м');
		expect(formatDistance(1530)).toBe('1,5 км');
	});
});
