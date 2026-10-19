import 'server-only';
import { type Place } from './places.schema';

const SYNONYMS: Record<string, readonly string[]> = {
	вид: ['viewpoint', 'view'],
	дет: ['playground', 'zoo', 'museum', 'kids'],
	коф: ['cafe'],
	ноч: ['bar', 'nightclub', 'night'],
	площадк: ['playground'],
	ребен: ['playground', 'zoo', 'museum', 'kids'],
	розетк: ['power_sockets'],
	смотров: ['viewpoint', 'view'],
	тих: ['library', 'park', 'cafe'],
};
const STOP_WORDS = new Set(['в', 'во', 'где', 'для', 'и', 'или', 'мне', 'на', 'с', 'со', 'у', 'хочу', 'я']);

function normalize(word: string): string {
	const lowered = word.toLowerCase().replaceAll('ё', 'е');
	// A deliberately small Russian stemmer, not morphology: retain at least three characters.
	return lowered.length > 4
		? lowered.replace(
				/(?:и?ями|ами|ого|ему|ому|ыми|ими|ий|ый|ой|ая|яя|ое|ее|ые|ие|ов|ев|ам|ям|ах|ях|ом|ем|а|я|ы|и|у|ю|е|о|ь)$/,
				'',
			)
		: lowered;
}

function tokens(text: string): string[] {
	return (
		text
			.toLowerCase()
			.replaceAll('ё', 'е')
			.match(/[\p{L}\p{N}_]+/gu) ?? []
	)
		.filter((word) => !STOP_WORDS.has(word))
		.map(normalize);
}

function matchesFamily(word: string, stem: string): boolean {
	// Short stems must not confuse видео with вид or детектив with дети.
	if (stem === 'вид') return ['вид', 'вида', 'виду', 'виды'].includes(word);
	if (stem === 'дет') return ['дет', 'детей', 'дети'].includes(word) || word.startsWith('детск');
	return word.startsWith(stem);
}

export function lexicalScores(query: string, places: readonly Place[]): Map<string, number> {
	const words = [...new Set(tokens(query))];
	const scores = new Map<string, number>();
	for (const place of places) {
		const name = new Set(tokens(`${place.name} ${place.nameEn ?? ''}`));
		const description = new Set(tokens(place.description ?? ''));
		const metadata = new Set([normalize(place.category), ...place.tags.map(normalize)]);
		let sum = 0;
		for (const word of words) {
			const expansions = Object.entries(SYNONYMS)
				.filter(([stem]) => matchesFamily(word, stem))
				.flatMap(([, values]) => values);
			const synonymMatch = expansions.some((value) => metadata.has(normalize(value)));
			if (name.has(word)) sum += 1;
			else if (metadata.has(word) || synonymMatch) sum += 0.8;
			else if (description.has(word)) sum += 0.5;
		}
		scores.set(place.id, words.length ? sum / words.length : 0);
	}
	return scores;
}
