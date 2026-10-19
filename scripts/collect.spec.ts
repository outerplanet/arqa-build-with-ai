import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	capitalize,
	type Entity,
	entityDistance,
	entityImage,
	freeLicense,
	matchEntity,
	osmImage,
	plainText,
	russianText,
} from './collect';

const astana = { lat: 51.1645742, lon: 71.4237928 };
const label = (value: string) => ({ value });

void test('keeps only Russian descriptions', () => {
	assert.equal(russianText('достопримечательность города'), 'достопримечательность города');
	assert.equal(
		russianText('Сеть Burger King: компания в сфере быстрого питания'),
		'Сеть Burger King: компания в сфере быстрого питания',
	);
	assert.equal(russianText('urban park in Astana, Kazakhstan'), null);
	assert.equal(russianText('Астанадағы саябақ'), null);
	assert.equal(russianText('  ‎ '), null);
	assert.equal(russianText(undefined), null);
});

void test('capitalises the first letter only', () => {
	assert.equal(capitalize('достопримечательность города'), 'Достопримечательность города');
	assert.equal(capitalize('музей в Астане'), 'Музей в Астане');
});

void test('rejects the ministry linked from the МГУ branch even though its P625 is in the same block', () => {
	const ministry: Entity = {
		claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 51.164_444_44, longitude: 71.424_166_67 } } } }] },
		labels: {
			en: label('Ministry of Agriculture'),
			ru: label('Министерство сельского хозяйства Республики Казахстан'),
		},
	};
	const names = ['Казахстанский филиал московского государственного университета имени М. В. Ломоносова'];
	assert.equal(matchEntity(ministry, names), false);
	assert.equal(entityDistance(ministry, astana), 30);
});

void test('accepts an item by a shared name word or by a whole short label', () => {
	const baiterek: Entity = { labels: { en: label('Bayterek Tower'), ru: label('Байтерек') } };
	assert.equal(matchEntity(baiterek, ['Байтерек']), true);
	const kfc: Entity = { aliases: { en: [label('KFC')] }, labels: { en: label('Kentucky Fried Chicken') } };
	assert.equal(matchEntity(kfc, ['KFC']), true);
	assert.equal(entityDistance(kfc, astana), null);
});

void test('city and country words alone do not make a match', () => {
	const entity: Entity = { labels: { ru: label('Министерство Республики Казахстан в Астане') } };
	assert.equal(matchEntity(entity, ['Университет Астана, Казахстан']), false);
});

void test('reads the image file from P18 and from an OSM file tag, never from a category', () => {
	const entity: Entity = {
		claims: {
			P18: [
				{ mainsnak: { datavalue: { value: 'Old.jpg' } }, rank: 'normal' },
				{ mainsnak: { datavalue: { value: 'Baiterek tower.jpg' } }, rank: 'preferred' },
			],
		},
	};
	assert.equal(entityImage(entity), 'File:Baiterek tower.jpg');
	assert.equal(entityImage(undefined), null);
	assert.equal(osmImage('File:Khan_Shatyr.jpg'), 'File:Khan Shatyr.jpg');
	assert.equal(osmImage('Category:Astana Opera'), null);
});

void test('accepts only free licences', () => {
	for (const license of ['CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 2.0 de', 'Public domain'])
		assert.equal(freeLicense(license), true, license);
	for (const license of ['GFDL', 'Copyrighted free use', 'CC BY-NC 2.0', null])
		assert.equal(freeLicense(license), false);
});

void test('turns the Commons author HTML into plain text', () => {
	assert.equal(plainText('<a href="//commons.wikimedia.org/wiki/User:Ken">Ken &amp; Co</a>\n'), 'Ken & Co');
	assert.equal(plainText('<span></span>'), null);
});
