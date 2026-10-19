import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendationShape } from './qa-contract.mjs';

await test('rejects empty recommendations in a positive case', () => {
	assert.equal(recommendationShape({ reply: 'Подходящих мест не найдено.', selectedCount: 0 }), false);
});
await test('allows an explicitly expected empty or clarification result', () => {
	assert.equal(recommendationShape({ allowEmpty: true, reply: 'Уточните ориентир.', selectedCount: 0 }), true);
});
await test('requires one labelled generated action for each selected recommendation', () => {
	assert.equal(recommendationShape({ reply: 'Почему: парк.', selectedCount: 1 }), false);
	assert.equal(recommendationShape({ reply: 'Что делать: зайти на выставку.', selectedCount: 1 }), false);
	assert.equal(
		recommendationShape({ reply: 'Что делать: осмотреться (сгенерированная идея).', selectedCount: 1 }),
		true,
	);
	assert.equal(
		recommendationShape({ reply: 'Что делать: осмотреться (сгенерированная идея).', selectedCount: 2 }),
		false,
	);
});
await test('rejects more than three recommendations', () => {
	assert.equal(recommendationShape({ reply: '', selectedCount: 4 }), false);
});
