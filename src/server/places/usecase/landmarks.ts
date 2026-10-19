import 'server-only';

/** Aliases, not a second POI database: coordinates and sources always come from the dataset. */
export const LANDMARKS: readonly (readonly string[])[] = [
	['экспо', 'expo', 'нур алем', 'нұр әлем', 'nur alem'],
	['байтерек', 'бәйтерек', 'baiterek', 'bayterek'],
	['хан шатыр', 'khan shatyr'],
	['mega silk way', 'мега силк вей', 'мега шелковый путь'],
	['нурлы жол', 'нұрлы жол', 'nurly zhol'],
	['астана 1', 'astana 1'],
	['аэропорт', 'airport', 'нурсултан назарбаев', 'nursultan nazarbayev international airport'],
	['ак орда', 'ақорда', 'ak orda', 'akorda'],
	['дворец мира и согласия', 'бейбітшілік және келісім сарайы', 'palace of peace and reconciliation'],
	['ену', 'enu', 'евразийский национальный университет'],
	['aitu', 'astana it university', 'астана ит университет'],
];

export function normalizeLocation(text: string): string {
	return text
		.toLocaleLowerCase('ru')
		.replaceAll('ё', 'е')
		.replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

export function mentions(text: string, name: string): boolean {
	return ` ${normalizeLocation(text)} `.includes(` ${normalizeLocation(name)} `);
}
