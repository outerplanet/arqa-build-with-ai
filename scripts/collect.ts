/* eslint-disable no-await-in-loop -- Sequential requests respect upstream rate limits. */
/* eslint-disable no-console -- This offline CLI reports collection progress and failures to its operator. */
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import { CATEGORIES, type Category, type Place, placeSchema } from '../src/server/places/model/places.schema';

const bbox = [51.03, 71.25, 51.25, 71.65] as const;
const headers = { 'User-Agent': 'AstanaWalks/1.0 (https://github.com/outerplanet/arqa-build-with-ai)' };
const elementSchema = z.object({
	center: z.object({ lat: z.number(), lon: z.number() }).optional(),
	id: z.number().int().positive(),
	lat: z.number().optional(),
	lon: z.number().optional(),
	tags: z.record(z.string(), z.string()),
	type: z.enum(['node', 'way', 'relation']),
});
const responseSchema = z.object({
	elements: z.array(elementSchema),
	osm3s: z.object({ timestamp_osm_base: z.string() }),
	remark: z.string().optional(),
});
type Element = z.infer<typeof elementSchema>;

async function request(url: string, options: RequestInit = {}): Promise<unknown> {
	const requestHeaders = new Headers(options.headers);
	requestHeaders.set('User-Agent', headers['User-Agent']);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const response = await fetch(url, {
				...options,
				headers: requestHeaders,
				signal: AbortSignal.timeout(120000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return (await response.json()) as unknown;
		} catch (error) {
			if (attempt === 2) throw error;
			await pause(2000 * (attempt + 1));
		}
	}
	throw new Error('Request failed');
}

function category(tags: Record<string, string>): Category {
	const candidates = [tags.amenity, tags.tourism, tags.leisure, tags.historic, tags.shop];
	const found = CATEGORIES.find((value) => value !== 'other' && candidates.includes(value));
	if (found !== undefined) return found;
	if (tags.historic === 'memorial') return 'monument';
	if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium') return 'sports';
	return 'other';
}

function normalize(element: Element): Place | null {
	const { tags } = element;
	const point = element.center ?? element;
	if (
		point.lat === undefined ||
		point.lon === undefined ||
		point.lat < bbox[0] ||
		point.lat > bbox[2] ||
		point.lon < bbox[1] ||
		point.lon > bbox[3]
	)
		return null;
	const name = tags['name:ru'] ?? tags.name;
	if (name === undefined || name.trim() === '') return null;
	const normalizedTags: string[] = [];
	if (tags.internet_access === 'wlan' || tags.wifi === 'yes') normalizedTags.push('wifi');
	if (tags.socket === 'yes' || tags.power_supply === 'yes') normalizedTags.push('power_sockets');
	if (tags.outdoor_seating === 'yes') normalizedTags.push('outdoor_seating');
	if (tags.fee === 'no') normalizedTags.push('free');
	if (tags.wheelchair === 'yes') normalizedTags.push('wheelchair');
	const description = tags['description:ru'] ?? tags.description ?? null;
	return placeSchema.parse({
		address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null,
		category: category(tags),
		description,
		descriptionSource: description === null ? null : 'osm',
		id: `osm:${element.type}/${element.id}`,
		lat: point.lat,
		lon: point.lon,
		name,
		nameEn: tags['name:en'] ?? null,
		openingHours: tags.opening_hours?.trim() || null,
		phone: tags.phone ?? tags['contact:phone'] ?? null,
		popularity: null,
		sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
		tags: normalizedTags,
		website: tags.website ?? tags['contact:website'] ?? null,
		wheelchair: ['limited', 'no', 'yes'].includes(tags.wheelchair ?? '') ? tags.wheelchair : null,
	});
}

function distance(a: Place, b: Place): number {
	const radians = Math.PI / 180;
	const term =
		Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
		Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(((b.lon - a.lon) * radians) / 2) ** 2;
	return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(term)));
}

async function main() {
	const startedAt = new Date().toISOString();
	const selectors = [
		'[amenity~"^(cafe|restaurant|fast_food|bar|nightclub|theatre|cinema|library|place_of_worship|university)$"]',
		'[tourism]',
		'[leisure~"^(park|garden|playground|sports_centre|stadium)$"]',
		'[historic]',
		'[shop=mall]',
		'[building~"^(museum|train_station)$"]',
		'[aeroway=aerodrome]',
		'[name~"^(Нұр Әлем|Нур Алем|Nur Alem|EXPO|Экспо)$",i]',
	];
	const query = `[out:json][timeout:90];(${selectors.map((selector) => `nwr${selector}["name"](${bbox.join(',')});`).join('')});out center tags;`;
	let collected: z.infer<typeof responseSchema> | undefined;
	let endpoint = '';
	for (const mirror of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
		try {
			collected = responseSchema.parse(
				await request(mirror, { body: new URLSearchParams({ data: query }), method: 'POST' }),
			);
			if (collected.remark !== undefined) throw new Error('Overpass returned incomplete data');
			endpoint = mirror;
			break;
		} catch {
			console.error('Не удалось получить полный ответ Overpass, пробуем запасной сервер.');
			collected = undefined;
		}
	}
	if (collected === undefined) throw new Error('Сбор не завершён. Предыдущие файлы сохранены.');
	const rows = collected.elements
		.map((element) => ({ element, place: normalize(element) }))
		.filter((row): row is { element: Element; place: Place } => row.place !== null);
	// Prefer the most informative representation of a named object before deduplication.
	rows.sort(
		(a, b) =>
			Number(b.place.openingHours !== null) +
			Number(b.place.description !== null) -
			Number(a.place.openingHours !== null) -
			Number(a.place.description !== null),
	);
	const unique: typeof rows = [];
	for (const row of rows) {
		if (
			!unique.some(
				(other) =>
					other.place.name.toLocaleLowerCase('ru') === row.place.name.toLocaleLowerCase('ru') &&
					distance(other.place, row.place) < 50,
			)
		)
			unique.push(row);
	}
	if (unique.length === 0) throw new Error('Пустой ответ: предыдущие файлы сохранены.');
	const ids = [
		...new Set(
			unique
				.map((row) => row.element.tags.wikidata)
				.filter((id): id is string => id !== undefined && /^Q[1-9]\d*$/.test(id)),
		),
	];
	const entitySchema = z.object({
		descriptions: z.record(z.string(), z.object({ value: z.string() })).optional(),
		sitelinks: z.record(z.string(), z.unknown()).optional(),
	});
	const entities = new Map<string, z.infer<typeof entitySchema>>();
	let failedBatches = 0;
	for (let offset = 0; offset < ids.length; offset += 50) {
		const parameters = new URLSearchParams({
			action: 'wbgetentities',
			format: 'json',
			ids: ids.slice(offset, offset + 50).join('|'),
			languages: 'ru',
			props: 'descriptions|sitelinks',
		});
		try {
			const result = z
				.object({ entities: z.record(z.string(), entitySchema) })
				.parse(await request(`https://www.wikidata.org/w/api.php?${parameters.toString()}`));
			for (const [id, entity] of Object.entries(result.entities)) entities.set(id, entity);
		} catch {
			failedBatches += 1;
			console.error('Часть Wikidata недоступна, пропуски будут отражены в сводке.');
		}
		await pause(200);
	}
	for (const row of unique) {
		const entity = entities.get(row.element.tags.wikidata ?? '');
		const description = entity?.descriptions?.ru?.value;
		if (row.place.description === null && description !== undefined && description.trim() !== '') {
			row.place.description = description;
			row.place.descriptionSource = 'wikidata';
		}
		if (entity?.sitelinks !== undefined)
			row.place.popularity = Math.min(1, Math.log1p(Object.keys(entity.sitelinks).length) / Math.log(301));
	}
	const places = z.array(placeSchema).parse(unique.map((row) => row.place).sort((a, b) => a.id.localeCompare(b.id)));
	const coverage = (count: number) => ({
		count,
		fraction: count / places.length,
		percent: Math.round((count / places.length) * 10000) / 100,
	});
	const summary = {
		attribution: [
			'© участники OpenStreetMap, ODbL https://www.openstreetmap.org/copyright',
			'Wikidata, CC0 https://www.wikidata.org/wiki/Wikidata:Licensing',
		],
		bbox,
		byCategory: Object.fromEntries(
			CATEGORIES.map((value) => [value, places.filter((place) => place.category === value).length]),
		),
		collectedAt: new Date().toISOString(),
		descriptions: coverage(places.filter((place) => place.description !== null).length),
		duplicatesRemoved: rows.length - unique.length,
		endpoint,
		failedWikidataBatches: failedBatches,
		limitations: [
			'Выборка именованных POI в bbox, не полный реестр Астаны.',
			'Наличие opening_hours не означает проверенную актуальность или статус «открыто».',
			'Описания могут быть краткими. Популярность из числа sitelinks, не пользовательский рейтинг.',
		],
		openingHours: coverage(places.filter((place) => place.openingHours !== null).length),
		osmBaseTimestamp: collected.osm3s.timestamp_osm_base,
		osmDescriptions: coverage(places.filter((place) => place.descriptionSource === 'osm').length),
		query,
		rawElements: collected.elements.length,
		startedAt,
		status: failedBatches === 0 ? 'complete' : 'partial_wikidata',
		total: places.length,
		wikidataDescriptions: coverage(places.filter((place) => place.descriptionSource === 'wikidata').length),
		wikidataLinked: coverage(unique.filter((row) => /^Q[1-9]\d*$/.test(row.element.tags.wikidata ?? '')).length),
		wikidataPopularity: coverage(places.filter((place) => place.popularity !== null).length),
	};
	await mkdir('data', { recursive: true });
	await writeFile('data/poi.json', `${JSON.stringify(places, null, 2)}\n`);
	await writeFile('data/collect_summary.json', `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify(summary, null, 2));
}

main().catch(() => {
	console.error('Сбор завершился ошибкой. Проверьте подключение и повторите pnpm collect.');
	process.exitCode = 1;
});
