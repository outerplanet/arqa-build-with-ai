import 'server-only';

/** Aliases, not a second POI database: coordinates and sources always come from the dataset. */
export const LANDMARKS: readonly (readonly string[])[] = [
	['экспо', 'expo', 'экспо 2017', 'expo 2017'],
	['нур алем', 'нуралем', 'нуралема', 'нур алема', 'нұр әлем', 'nur alem', 'alem.ai'],
	['байтерек', 'байтерека', 'бәйтерек', 'baiterek', 'bayterek'],
	['хан шатыр', 'хан шатыра', 'khan shatyr'],
	['mega silk way', 'мега силк вей', 'мега шелковый путь'],
	['нурлы жол', 'нұрлы жол', 'nurly zhol'],
	['астана 1', 'astana 1'],
	['аэропорт', 'airport', 'нурсултан назарбаев', 'nursultan nazarbayev international airport'],
	['ак орда', 'ақорда', 'ak orda', 'akorda'],
	['дворец мира и согласия', 'бейбітшілік және келісім сарайы', 'palace of peace and reconciliation'],
	['ену', 'enu', 'евразийский национальный университет'],
	['aitu', 'astana it university', 'астана ит университет'],
];

/**
 * Named public landmarks, not general deduplication. IDs and object types are verified in
 * data/collect_raw.json: EXPO is an exhibition building, EXPO-2017 is a quarter; Baiterek's
 * monument is distinct from the namesake rail station. Mega's building carries its address
 * and hours, unlike the nearby mall label node. Nur Alem's former name on this exact way is
 * confirmed by OSM versions 11–12 in data/nur-alem-history.json. Never copy coordinates here.
 */
export const LANDMARK_IDS: ReadonlyMap<readonly string[], string> = new Map([
	[LANDMARKS[0]!, 'osm:way/454853233'],
	[LANDMARKS[1]!, 'osm:way/454857501'],
	[LANDMARKS[2]!, 'osm:way/230401645'],
	[LANDMARKS[3]!, 'osm:way/460703779'],
	[LANDMARKS[4]!, 'osm:way/499328514'],
]);

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
