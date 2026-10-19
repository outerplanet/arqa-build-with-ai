import 'server-only';

/** Aliases, not a second POI database: coordinates and sources always come from the dataset. */
export const EXPO_ALIASES = ['экспо', 'expo', 'экспо 2017', 'expo 2017'] as const;
export const NUR_ALEM_ALIASES = ['нур алем', 'нұр әлем', 'нұр алем', 'нур әлем', 'nur alem'] as const;
export const ALEM_AI_ALIASES = ['alem.ai', 'alem.ai международный центр искусственного интеллекта'] as const;
export const BAYTEREK_ALIASES = ['байтерек', 'бәйтерек', 'baiterek', 'bayterek'] as const;
export const MEGA_ALIASES = ['mega silk way', 'mega silkway astana', 'мега силк вей', 'мега шелковый путь'] as const;

export const LANDMARKS: readonly (readonly string[])[] = [
	EXPO_ALIASES,
	NUR_ALEM_ALIASES,
	ALEM_AI_ALIASES,
	BAYTEREK_ALIASES,
	['хан шатыр', 'khan shatyr'],
	MEGA_ALIASES,
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
