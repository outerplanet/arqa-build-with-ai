/* eslint-disable no-await-in-loop -- Sequential requests respect upstream rate limits. */
/* eslint-disable no-console -- This offline CLI reports collection progress and failures to its operator. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CATEGORIES, type Category, type Place, placeSchema } from '../src/server/places/model/places.schema';
import { publishCollection } from '../src/server/places/repo/publication';

const bbox = [51.03, 71.25, 51.25, 71.65] as const;
// Wikimedia's User-Agent policy asks for a way to reach the operator; the repository is that contact.
const headers = {
	'User-Agent': 'AstanaWalks/1.0 (https://github.com/outerplanet/arqa-build-with-ai; data collection script)',
};
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
const streetSchema = z.object({
	elements: z.array(
		z.object({
			geometry: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
			id: z.number().int().positive(),
			tags: z.record(z.string(), z.string()),
		}),
	),
	remark: z.string().optional(),
});
type Element = z.infer<typeof elementSchema>;
interface Street {
	id: number;
	name: string;
	points: { lat: number; lon: number }[];
}
interface GeneratedName {
	distanceM: number | null;
	id: string;
	name: string;
	streetWayId: number | null;
}

/** Comparable name key: case, ё, punctuation and spaces do not distinguish two names. */
function nameKey(name: string): string {
	return name
		.toLocaleLowerCase('ru')
		.replaceAll('ё', 'е')
		.replaceAll(/[^\p{L}\p{N}]+/gu, '');
}

/** Accommodation is not a walk recommendation: hotels and daily rentals are excluded from poi.json. */
const ACCOMMODATION = new Set(['apartment', 'chalet', 'guest_house', 'hostel', 'hotel', 'motel']);
const DAILY_RENT = /посуточн|апартамент|(?:^|[^\p{L}])(?:daily|рент)(?:[^\p{L}]|$)/iu;
/** Names that only repeat a category word identify nothing and must not win deduplication. */
const GENERIC_NAMES = new Set(
	[
		'бар',
		'детская площадка',
		'кафе',
		'кофейня',
		'музей',
		'памятник',
		'парк',
		'пиццерия',
		'ресторан',
		'смотровая площадка',
		'сквер',
		'столовая',
		'фастфуд',
		'шашлычная',
		'bar',
		'cafe',
		'coffee',
		'coffee shop',
		'restaurant',
	].map((name) => nameKey(name)),
);
/** Unnamed objects that are still worth a visit get a clearly generic label plus the nearest street. */
const UNNAMED_LABELS: Record<string, string> = { playground: 'Детская площадка', viewpoint: 'Смотровая площадка' };

async function request(url: string, options: RequestInit = {}): Promise<unknown> {
	const requestHeaders = new Headers(options.headers);
	requestHeaders.set('User-Agent', headers['User-Agent']);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			const response = await fetch(url, {
				...options,
				headers: requestHeaders,
				signal: AbortSignal.timeout(120000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return (await response.json()) as unknown;
		} catch (error) {
			if (attempt === 3) throw error;
			// Exponential backoff, as public Overpass servers ask for when at capacity.
			await pause(3000 * 2 ** attempt);
		}
	}
	throw new Error('Request failed');
}

const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LATIN = /\p{Script=Latin}/gu;
/** Letters that exist in Kazakh Cyrillic but not in Russian. */
const KAZAKH_ONLY = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/u;

/** The UI is Russian: a text is kept only when it is Russian, otherwise the field stays empty. */
export function russianText(value: string | undefined): string | null {
	// Direction marks occasionally leak into Wikidata strings; they are invisible noise, not content.
	const text = value?.replaceAll(/[‎‏]/gu, '').trim();
	if (text === undefined || text === '' || KAZAKH_ONLY.test(text)) return null;
	const cyrillic = text.match(CYRILLIC)?.length ?? 0;
	const latin = text.match(LATIN)?.length ?? 0;
	return cyrillic > 0 && cyrillic >= latin ? text : null;
}

function category(tags: Record<string, string>): Category {
	const candidates = [tags.amenity, tags.tourism, tags.leisure, tags.historic, tags.shop];
	const found = CATEGORIES.find((value) => value !== 'other' && candidates.includes(value));
	if (found !== undefined) return found;
	if (tags.historic === 'memorial') return 'monument';
	if (tags.museum !== undefined && tags.museum !== 'no') return 'museum';
	if (tags.amenity === 'planetarium') return 'museum';
	// OSM arts_centre is a venue where arts are performed (philharmonic, organ hall, circus in Astana).
	if (tags.amenity === 'arts_centre') return 'theatre';
	if (tags.leisure === 'water_park') return 'theme_park';
	if (tags.tourism === 'aquarium') return 'attraction';
	if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium') return 'sports';
	return 'other';
}

/** Every tag is read from an explicit OSM key; nothing is inferred from the category alone. */
function placeTags(tags: Record<string, string>): string[] {
	const result: string[] = [];
	const keys = Object.keys(tags);
	if (tags.internet_access === 'wlan' || tags.wifi === 'yes') result.push('wifi');
	if (
		tags.socket === 'yes' ||
		tags.power_supply === 'yes' ||
		keys.some((key) => key.startsWith('socket:') && !['0', 'no'].includes(tags[key] ?? ''))
	)
		result.push('power_sockets');
	if (tags.outdoor_seating === 'yes') result.push('outdoor_seating');
	if (tags.fee === 'no') result.push('free');
	if (tags.wheelchair === 'yes') result.push('wheelchair');
	if (
		tags.leisure === 'playground' ||
		tags.leisure === 'water_park' ||
		tags.tourism === 'zoo' ||
		tags.tourism === 'theme_park' ||
		tags.kids_area === 'yes' ||
		keys.some((key) => key.startsWith('playground:'))
	)
		result.push('kids');
	if (tags.tourism === 'viewpoint' || tags['tower:type'] === 'observation' || tags.viewpoint === 'yes')
		result.push('view');
	if (tags.interactive === 'yes' || ['children', 'science', 'technology'].includes(tags.museum ?? ''))
		result.push('interactive');
	// 'night' is intentionally not static: whether a place is open late is decided at runtime from opening_hours.
	return result;
}

function excluded(tags: Record<string, string>): string | null {
	if (ACCOMMODATION.has(tags.tourism ?? '')) return `tourism=${tags.tourism}`;
	const names = [tags.name, tags['name:ru'], tags['name:en']].filter((name): name is string => name !== undefined);
	if (names.some((name) => DAILY_RENT.test(name))) return 'daily_rent_name';
	if (tags.leisure === 'playground' && ['no', 'private'].includes(tags.access ?? '')) return 'private_playground';
	return null;
}

function point(element: Element): { lat: number; lon: number } | null {
	const value = element.center ?? element;
	if (
		value.lat === undefined ||
		value.lon === undefined ||
		value.lat < bbox[0] ||
		value.lat > bbox[2] ||
		value.lon < bbox[1] ||
		value.lon > bbox[3]
	)
		return null;
	return { lat: value.lat, lon: value.lon };
}

function unnamedKind(tags: Record<string, string>): string | null {
	if (tags.leisure === 'playground') return 'playground';
	if (tags.tourism === 'viewpoint') return 'viewpoint';
	return null;
}

/** Distance from a point to a street polyline, metres, on a local equirectangular projection. */
function streetDistance(origin: { lat: number; lon: number }, street: Street): number {
	const scaleY = 111320;
	const scaleX = 111320 * Math.cos((origin.lat * Math.PI) / 180);
	let best = Number.POSITIVE_INFINITY;
	for (let index = 0; index < street.points.length; index += 1) {
		const a = street.points[index]!;
		const b = street.points[Math.min(index + 1, street.points.length - 1)]!;
		const ax = (a.lon - origin.lon) * scaleX;
		const ay = (a.lat - origin.lat) * scaleY;
		const bx = (b.lon - origin.lon) * scaleX;
		const by = (b.lat - origin.lat) * scaleY;
		const length = (bx - ax) ** 2 + (by - ay) ** 2;
		const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / length));
		best = Math.min(best, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
	}
	return best;
}

function nearestStreet(origin: { lat: number; lon: number }, streets: readonly Street[]) {
	let best: { distanceM: number; street: Street } | null = null;
	for (const street of streets) {
		const distanceM = streetDistance(origin, street);
		if (distanceM <= 150 && (best === null || distanceM < best.distanceM)) best = { distanceM, street };
	}
	return best;
}

function normalize(
	element: Element,
	{ generated, streets }: { generated: GeneratedName[]; streets: readonly Street[] },
): Place | null {
	const { tags } = element;
	const location = point(element);
	if (location === null) return null;
	const id = `osm:${element.type}/${element.id}`;
	let name = (tags['name:ru'] ?? tags.name)?.trim();
	if (name === undefined || name === '') {
		const kind = unnamedKind(tags);
		if (kind === null) return null;
		const nearest = nearestStreet(location, streets);
		const label = `${UNNAMED_LABELS[kind]}${tags.indoor === undefined || tags.indoor === 'no' ? '' : ' в помещении'}`;
		name = nearest === null ? label : `${label}, ${nearest.street.name}`;
		generated.push({
			distanceM: nearest === null ? null : Math.round(nearest.distanceM),
			id,
			name,
			streetWayId: nearest?.street.id ?? null,
		});
	}
	const osmDescription = russianText(tags['description:ru']) ?? russianText(tags.description);
	return placeSchema.parse({
		address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null,
		category: category(tags),
		description: osmDescription,
		descriptionSource: osmDescription === null ? null : 'osm',
		id,
		image: null,
		lat: location.lat,
		lon: location.lon,
		name,
		nameEn: tags['name:en'] ?? null,
		openingHours: tags.opening_hours?.trim() || null,
		phone: tags.phone ?? tags['contact:phone'] ?? null,
		popularity: null,
		sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
		tags: placeTags(tags),
		website: tags.website ?? tags['contact:website'] ?? null,
		wheelchair: ['limited', 'no', 'yes'].includes(tags.wheelchair ?? '') ? tags.wheelchair : null,
	});
}

function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const radians = Math.PI / 180;
	const term =
		Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
		Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(((b.lon - a.lon) * radians) / 2) ** 2;
	return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(term)));
}

interface Row {
	element: Element;
	generic: boolean;
	names: Set<string>;
	place: Place;
}
interface Merge {
	dropped: string;
	kept: string;
	reason: 'cross_language' | 'same_name';
}

function makeRow({ element, place }: { element: Element; place: Place }, generatedIds: ReadonlySet<string>): Row {
	const generic = generatedIds.has(place.id) || GENERIC_NAMES.has(nameKey(place.name));
	const names = new Set(
		generic
			? []
			: ['name', 'name:ru', 'name:en', 'name:kk', 'int_name', 'official_name']
					.map((key) => element.tags[key])
					.filter((value): value is string => value !== undefined)
					.map((value) => nameKey(value))
					.filter((value) => value !== '' && !GENERIC_NAMES.has(value)),
	);
	return { element, generic, names, place };
}

/** Which rule, if any, says that two rows describe the same real object. */
function duplicateReason(a: Row, b: Row): Merge['reason'] | null {
	const metres = distance(a.place, b.place);
	if (metres >= 50) return null;
	if (a.place.name.toLocaleLowerCase('ru') === b.place.name.toLocaleLowerCase('ru')) return 'same_name';
	if (a.place.category !== b.place.category) return null;
	// Proximity alone is never identity: a node near an outline may be a different venue in the same
	// building. Verified exceptions (Mega Silk Way node/way) live in resolveLocation, not in the data.
	return [...a.names].some((name) => b.names.has(name)) ? 'cross_language' : null;
}

/** A specific name beats a generic one; otherwise the representation with more OSM tags wins. */
function better(a: Row, b: Row): boolean {
	if (a.generic !== b.generic) return !a.generic;
	return Object.keys(a.element.tags).length > Object.keys(b.element.tags).length;
}

function deduplicate(rows: Row[]): { merges: Merge[]; unique: Row[] } {
	const informative = (row: Row) => Number(row.place.openingHours !== null) + Number(row.place.description !== null);
	const ordered = rows.toSorted(
		(a, b) =>
			Number(a.generic) - Number(b.generic) ||
			informative(b) - informative(a) ||
			Object.keys(b.element.tags).length - Object.keys(a.element.tags).length ||
			a.place.id.localeCompare(b.place.id),
	);
	const unique: Row[] = [];
	const merges: Merge[] = [];
	for (const row of ordered) {
		const index = unique.findIndex((other) => duplicateReason(other, row) !== null);
		const other = unique[index];
		const reason = other === undefined ? null : duplicateReason(other, row);
		if (other === undefined || reason === null) unique.push(row);
		else if (reason !== 'same_name' && better(row, other)) {
			unique[index] = row;
			merges.push({ dropped: other.place.id, kept: row.place.id, reason });
		} else merges.push({ dropped: row.place.id, kept: other.place.id, reason });
	}
	return { merges, unique };
}

/** Reproducible fallback: copy public source rows, never invent missing landmarks. */
function sampleFiles({
	collectedAt,
	places,
	sourceText,
}: {
	collectedAt: string;
	places: Place[];
	sourceText: string;
}): Record<string, string> {
	const selected = new Map<string, Place>();
	const landmarks = [
		/^Байтерек$/i,
		/^Хан Шатыр$/i,
		/^(Нұр Әлем|Нур Алем|Nur Alem)$/i,
		/^EXPO$/i,
		/^Alem\.ai Международный центр искусственного интеллекта$/i,
		/^Mega Silk Way$/i,
		/^Центральный парк$/i,
		/^Ботанический сад$/i,
		/^Национальный музей Республики Казахстан$/i,
		/Астана Опера/i,
		/Дворец мира и согласия/i,
	];
	const missing: string[] = [];
	for (const pattern of landmarks) {
		const match =
			places.find((place) => pattern.test(place.name) && place.category !== 'other') ??
			places.find((place) => pattern.test(place.name));
		if (match === undefined) missing.push(pattern.source);
		else selected.set(match.id, match);
	}
	for (const desired of [
		'cafe',
		'cafe',
		'cafe',
		'playground',
		'bar',
		'theatre',
		'monument',
		'gallery',
		...CATEGORIES,
	]) {
		if (selected.size >= 15) break;
		const match = places.find((place) => place.category === desired && !selected.has(place.id));
		if (match !== undefined) selected.set(match.id, match);
	}
	if (selected.size !== 15) throw new Error('Not enough source places for the fallback sample');
	return {
		'poi.sample.json': `${JSON.stringify([...selected.values()], null, 2)}\n`,
		'sample_summary.json': `${JSON.stringify(
			{
				collectedAt,
				count: selected.size,
				missingLandmarkPatterns: missing,
				selection: 'Named landmarks first, then category diversity; exact copies from poi.json.',
				source: 'data/poi.json',
				sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
			},
			null,
			2,
		)}\n`,
	};
}

const MIRRORS = [
	'https://overpass-api.de/api/interpreter',
	'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
] as const;

async function overpass<S extends z.ZodType<{ remark?: string | undefined }>>(
	query: string,
	{ mirrors = MIRRORS, schema }: { mirrors?: readonly string[]; schema: S },
): Promise<{ endpoint: string; result: z.infer<S> } | null> {
	for (const mirror of mirrors) {
		try {
			const result = schema.parse(await request(`${mirror}?${new URLSearchParams({ data: query }).toString()}`));
			if (result.remark !== undefined) throw new Error('Overpass returned incomplete data');
			return { endpoint: mirror, result };
		} catch {
			console.error('Не удалось получить полный ответ Overpass, пробуем запасной сервер.');
		}
	}
	return null;
}

const textSchema = z.object({ value: z.string() });
const claimSchema = z.object({
	mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
	rank: z.string().optional(),
});
const entitySchema = z.object({
	aliases: z.record(z.string(), z.array(textSchema)).optional(),
	claims: z.record(z.string(), z.array(claimSchema)).optional(),
	descriptions: z.record(z.string(), textSchema).optional(),
	labels: z.record(z.string(), textSchema).optional(),
	sitelinks: z.record(z.string(), z.object({ site: z.string(), title: z.string() })).optional(),
});
export type Entity = z.infer<typeof entitySchema>;
/** Only the claims the collector reads are kept: image (P18) and coordinates (P625). */
const KEPT_CLAIMS = ['P18', 'P625'] as const;

/** Wikidata descriptions are lower-case by convention; a stored description starts a sentence. */
export function capitalize(text: string): string {
	return text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
}

/** Words that name the city or country identify nothing when matching a place to a Wikidata item. */
const MATCH_STOPWORDS = new Set([
	'astana',
	'kazakhstan',
	'republic',
	'астана',
	'астане',
	'астаны',
	'казахстан',
	'казахстана',
	'қазақстан',
	'республика',
	'республики',
]);

/** Comparable words of a name: lower case, ё→е, ≥4 letters, city and country names dropped. */
export function nameWords(name: string): Set<string> {
	return new Set(
		name
			.toLocaleLowerCase('ru')
			.replaceAll('ё', 'е')
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word.length >= 4 && !MATCH_STOPWORDS.has(word)),
	);
}

function entityCoordinates(entity: Entity): { lat: number; lon: number }[] {
	return (entity.claims?.P625 ?? []).flatMap((claim) => {
		const parsed = z
			.object({ latitude: z.number(), longitude: z.number() })
			.safeParse(claim.mainsnak.datavalue?.value);
		return parsed.success ? [{ lat: parsed.data.latitude, lon: parsed.data.longitude }] : [];
	});
}

/** Distance, metres, from the object to the nearest P625 of the item; null when the item has none. */
export function entityDistance(entity: Entity, location: { lat: number; lon: number }): number | null {
	const distances = entityCoordinates(entity).map((coordinate) => distance(coordinate, location));
	return distances.length === 0 ? null : Math.round(Math.min(...distances));
}

/**
 * A Wikidata link in OSM is sometimes simply wrong (an МГУ branch pointed at a ministry). The item
 * enriches the place only if its label or an alias shares a word with an OSM name, or the whole
 * label equals a name (short brands such as KFC).
 *
 * Coordinates are deliberately not enough: the ministry's P625 lies 30 m from the МГУ node (same
 * block), so a "within 2 km" rule accepts exactly the defect it is meant to catch. The distance is
 * still logged with every rejected match.
 */
export function matchEntity(entity: Entity, names: readonly string[]): boolean {
	const labels = ['ru', 'en', 'kk'].flatMap((lang) => [
		...(entity.labels?.[lang] === undefined ? [] : [entity.labels[lang].value]),
		...(entity.aliases?.[lang] ?? []).map((alias) => alias.value),
	]);
	const nameKeys = new Set(names.map((name) => nameKey(name)).filter((key) => key !== ''));
	const osmWords = new Set(names.flatMap((name) => [...nameWords(name)]));
	return labels.some(
		(label) => nameKeys.has(nameKey(label)) || [...nameWords(label)].some((word) => osmWords.has(word)),
	);
}

/** The image file of an item: a preferred-rank P18 first, otherwise the first one listed. */
export function entityImage(entity: Entity | undefined): string | null {
	const claims = entity?.claims?.P18 ?? [];
	const chosen =
		claims.find((claim) => claim.rank === 'preferred') ?? claims.find((claim) => claim.rank !== 'deprecated');
	const value = chosen?.mainsnak.datavalue?.value;
	return typeof value === 'string' && value.trim() !== '' ? `File:${value.trim()}` : null;
}

/** OSM `wikimedia_commons` may name a file or a category; only a file is a photo. */
export function osmImage(value: string | undefined): string | null {
	const match = /^\s*(?:File|Image):(.+\S)\s*$/i.exec(value ?? '');
	return match?.[1] === undefined ? null : `File:${match[1].replaceAll('_', ' ')}`;
}

/** Free licences only: CC0, CC BY, CC BY-SA (any version or port) and public domain. */
export function freeLicense(license: string | null): boolean {
	if (license === null) return false;
	return /^(?:cc0(?:\s+1\.0)?|cc[\s-]by(?:[\s-]sa)?(?:[\s-]\d.*)?|public\s+domain|pd(?:[\s-].*)?)$/i.test(
		license.trim(),
	);
}

/** Commons extmetadata is HTML; the author is stored as plain text. */
export function plainText(html: string | undefined): string | null {
	if (html === undefined) return null;
	const entities: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
	const text = html
		.replaceAll(/<[^>]*>/g, ' ')
		.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
			if (code.startsWith('#x') || code.startsWith('#X'))
				return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
			if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
			return entities[code.toLowerCase()] ?? whole;
		})
		.replaceAll(/\s+/g, ' ')
		.trim();
	return text === '' ? null : text;
}

const commonsSchema = z.object({
	query: z
		.object({
			normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
			pages: z.array(
				z.object({
					imageinfo: z
						.array(
							z.object({
								descriptionurl: z.string(),
								extmetadata: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
								thumburl: z.string().optional(),
								url: z.string(),
							}),
						)
						.optional(),
					missing: z.boolean().optional(),
					title: z.string(),
				}),
			),
			redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
		})
		.optional(),
});
type PlaceImage = NonNullable<Place['image']>;
interface SkippedImage {
	file: string;
	license: string | null;
	reason: 'missing' | 'not_free';
}

/** Commons files (≤50 per request) resolved to an 800 px thumbnail, page, author and free licence. */
async function commons(files: readonly string[]) {
	const images = new Map<string, PlaceImage>();
	const skipped: SkippedImage[] = [];
	let failedBatches = 0;
	for (let offset = 0; offset < files.length; offset += 50) {
		const batch = files.slice(offset, offset + 50);
		const parameters = new URLSearchParams({
			action: 'query',
			format: 'json',
			formatversion: '2',
			iiprop: 'url|extmetadata',
			iiurlwidth: '800',
			prop: 'imageinfo',
			redirects: '1',
			titles: batch.join('|'),
		});
		try {
			const { query } = commonsSchema.parse(
				await request(`https://commons.wikimedia.org/w/api.php?${parameters.toString()}`),
			);
			const rename = new Map(
				[...(query?.normalized ?? []), ...(query?.redirects ?? [])].map((pair) => [pair.from, pair.to]),
			);
			const pages = new Map((query?.pages ?? []).map((page) => [page.title, page]));
			for (const file of batch) {
				let title = file;
				for (let step = 0; step < 3 && rename.has(title); step += 1) title = rename.get(title)!;
				const info = pages.get(title)?.imageinfo?.[0];
				const meta = (key: string) => {
					const value = info?.extmetadata?.[key]?.value;
					return typeof value === 'string' ? value : undefined;
				};
				const license = plainText(meta('LicenseShortName'));
				if (info === undefined) skipped.push({ file, license: null, reason: 'missing' });
				else if (freeLicense(license))
					images.set(file, {
						author: plainText(meta('Artist')),
						license,
						pageUrl: info.descriptionurl,
						url: info.thumburl ?? info.url,
					});
				else skipped.push({ file, license, reason: 'not_free' });
			}
		} catch {
			failedBatches += 1;
			console.error('Часть Wikimedia Commons недоступна, фотографии для неё будут пустыми.');
		}
		await pause(200);
	}
	return { failedBatches, images, skipped };
}

/** Wikidata only: entities by Q-id, plus Wikipedia titles resolved to their Wikidata item (≤50 per request). */
async function wikidata(ids: readonly string[], titles: readonly string[]) {
	const entities = new Map<string, Entity>();
	const titleToId = new Map<string, string>();
	let failedBatches = 0;
	const batches: Record<string, string>[] = [];
	for (let offset = 0; offset < ids.length; offset += 50)
		batches.push({ ids: ids.slice(offset, offset + 50).join('|') });
	const bySite = new Map<string, string[]>();
	for (const reference of titles) {
		const [, lang, title] = /^([a-z-]{2,12}):(.+)$/.exec(reference) ?? [];
		if (lang !== undefined && title !== undefined)
			bySite.set(`${lang}wiki`, [...(bySite.get(`${lang}wiki`) ?? []), title.replaceAll('_', ' ')]);
	}
	for (const [site, list] of bySite)
		for (let offset = 0; offset < list.length; offset += 50)
			batches.push({ sites: site, titles: list.slice(offset, offset + 50).join('|') });
	for (const batch of batches) {
		const parameters = new URLSearchParams({
			action: 'wbgetentities',
			format: 'json',
			languages: 'ru|en|kk',
			props: 'aliases|claims|descriptions|labels|sitelinks',
			...batch,
		});
		try {
			const result = z
				.object({ entities: z.record(z.string(), entitySchema) })
				.parse(await request(`https://www.wikidata.org/w/api.php?${parameters.toString()}`));
			// Unresolved titles come back under negative keys; only real Q-ids are kept.
			for (const [id, entity] of Object.entries(result.entities).filter(([key]) => /^Q[1-9]\d*$/.test(key))) {
				const claims = Object.fromEntries(
					KEPT_CLAIMS.flatMap((property) => {
						const values = entity.claims?.[property];
						return values === undefined ? [] : [[property, values]];
					}),
				);
				entities.set(id, { ...entity, claims });
				const site = batch.sites;
				const title = site === undefined ? undefined : entity.sitelinks?.[site]?.title;
				if (site !== undefined && title !== undefined) titleToId.set(`${site.slice(0, -4)}:${title}`, id);
			}
		} catch {
			failedBatches += 1;
			console.error('Часть Wikidata недоступна, пропуски будут отражены в сводке.');
		}
		await pause(200);
	}
	return { entities, failedBatches, titleToId };
}

/** Russian description only: an English or Kazakh one would surface untranslated in the Russian UI. */
function description(entity: Entity | undefined): string | null {
	return russianText(entity?.descriptions?.ru?.value);
}

/** Every OSM name variant a Wikidata label may legitimately match. */
const NAME_KEYS = [
	'name',
	'name:ru',
	'name:en',
	'name:kk',
	'int_name',
	'official_name',
	'alt_name',
	'old_name',
	'short_name',
];

async function main() {
	if (process.argv.includes('--sample-only')) {
		const sourceText = await readFile('data/poi.json', 'utf8');
		const places = z.array(placeSchema).parse(JSON.parse(sourceText) as unknown);
		const summary = z
			.object({ collectedAt: z.string() })
			.parse(JSON.parse(await readFile('data/collect_summary.json', 'utf8')) as unknown);
		await publishCollection('data', sampleFiles({ collectedAt: summary.collectedAt, places, sourceText }));
		return;
	}
	const startedAt = new Date().toISOString();
	const area = bbox.join(',');
	const selectors = [
		'[amenity~"^(cafe|restaurant|fast_food|bar|nightclub|theatre|cinema|library|place_of_worship|university|arts_centre|planetarium|exhibition_centre)$"]',
		'[tourism]',
		'[museum]',
		'[leisure~"^(park|garden|playground|sports_centre|stadium|water_park)$"]',
		'[historic]',
		'[shop=mall]',
		'[building~"^(museum|train_station)$"]',
		'[aeroway=aerodrome]',
		'[name~"^(Нұр Әлем|Нур Алем|Nur Alem|EXPO|Экспо)$",i]',
		'[place=quarter][name~"^(ЭКСПО-2017|EXPO-2017)$",i]',
	];
	// Unnamed playgrounds and viewpoints are real places too; they receive a generic label below.
	const unnamedSelectors = ['[leisure=playground]', '[tourism=viewpoint]'];
	const query = `[out:json][timeout:90];(${selectors.map((selector) => `nwr${selector}["name"](${area});`).join('')}${unnamedSelectors.map((selector) => `nwr${selector}(${area});`).join('')});out center tags;`;
	// Only named streets within 150 m of an unnamed-capable object are needed to label it.
	const streetQuery = `[out:json][timeout:90];(${unnamedSelectors.map((selector) => `nwr${selector}(${area});`).join('')});way(around:150)[highway~"^(primary|secondary|tertiary|residential|living_street|pedestrian|unclassified)$"]["name"];out tags geom;`;
	const primary = await overpass(query, { schema: responseSchema });
	if (primary === null) throw new Error('Сбор не завершён. Предыдущие файлы сохранены.');
	const { endpoint, result: collected } = primary;
	// Measured 2026-10-19: overpass-api.de answered this around-query with 122 ways, maps.mail.ru with 850
	// at the same OSM base timestamp, so the street lookup asks the fuller server first.
	const streetResponse = await overpass(streetQuery, {
		mirrors: [MIRRORS[1], MIRRORS[0], MIRRORS[2]],
		schema: streetSchema,
	});
	if (streetResponse === null) console.error('Улицы недоступны: безымянные площадки получат название без улицы.');
	const streets: Street[] = (streetResponse?.result.elements ?? [])
		.filter((way) => (way.geometry?.length ?? 0) > 0)
		.map((way) => ({
			id: way.id,
			name: way.tags['name:ru'] ?? way.tags.name ?? '',
			points: way.geometry ?? [],
		}))
		.filter((street) => street.name.trim() !== '');
	const exclusions: Record<string, number> = {};
	const generated: GeneratedName[] = [];
	const normalized: { element: Element; place: Place }[] = [];
	for (const element of collected.elements) {
		const reason = excluded(element.tags);
		const place = reason === null ? normalize(element, { generated, streets }) : null;
		if (reason !== null) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
		else if (place !== null) normalized.push({ element, place });
	}
	const generatedIds = new Set(generated.map((item) => item.id));
	const { merges, unique } = deduplicate(normalized.map((row) => makeRow(row, generatedIds)));
	if (unique.length === 0) throw new Error('Пустой ответ: предыдущие файлы сохранены.');
	const valid = (id: string | undefined): id is string => id !== undefined && /^Q[1-9]\d*$/.test(id);
	const titles = unique
		.filter((row) => !valid(row.element.tags.wikidata) && row.element.tags.wikipedia !== undefined)
		.map((row) => row.element.tags.wikipedia!);
	const ids = [
		...new Set(
			unique.flatMap((row) => [row.element.tags.wikidata, row.element.tags['brand:wikidata']]).filter(valid),
		),
	];
	const { entities, failedBatches, titleToId } = await wikidata(ids, titles);
	let brandDescriptions = 0;
	const rejectedMatches: {
		distanceM: number | null;
		id: string;
		kind: 'brand' | 'own';
		label: string | null;
		name: string;
		wikidata: string;
	}[] = [];
	const imageFiles = new Map<string, string>();
	for (const row of unique) {
		const { tags } = row.element;
		const names = NAME_KEYS.map((key) => tags[key]).filter((value): value is string => value !== undefined);
		const brandNames = [tags.brand, tags['brand:ru'], tags['brand:en']].filter((value) => value !== undefined);
		const accept = (id: string | undefined, kind: 'brand' | 'own') => {
			const candidate = id === undefined ? undefined : entities.get(id);
			if (id === undefined || candidate === undefined) return undefined;
			if (matchEntity(candidate, kind === 'brand' ? [...names, ...brandNames] : names)) return candidate;
			rejectedMatches.push({
				distanceM: entityDistance(candidate, row.place),
				id: row.place.id,
				kind,
				label: candidate.labels?.ru?.value ?? candidate.labels?.en?.value ?? null,
				name: row.place.name,
				wikidata: id,
			});
			return undefined;
		};
		const own = valid(tags.wikidata) ? tags.wikidata : titleToId.get((tags.wikipedia ?? '').replaceAll('_', ' '));
		const entity = accept(own, 'own');
		const ownDescription = description(entity);
		if (row.place.description === null && ownDescription !== null) {
			row.place.description = capitalize(ownDescription);
			row.place.descriptionSource = 'wikidata';
		}
		const brandId = valid(tags['brand:wikidata']) ? tags['brand:wikidata'] : undefined;
		const brand = brandId === own ? undefined : accept(brandId, 'brand');
		const brandDescription = description(brand);
		const brandLabel = brand?.labels?.ru?.value ?? brand?.labels?.en?.value ?? tags.brand;
		// A brand describes the chain, not this branch: it is labelled as such and never feeds popularity.
		if (row.place.description === null && brandDescription !== null && brandLabel !== undefined) {
			row.place.description = `Сеть ${brandLabel}: ${brandDescription}`;
			row.place.descriptionSource = 'wikidata';
			brandDescriptions += 1;
		}
		if (entity?.sitelinks !== undefined)
			row.place.popularity = Math.min(1, Math.log1p(Object.keys(entity.sitelinks).length) / Math.log(301));
		// A brand logo is not a photo of this place, so only the place's own item or OSM tag gives an image.
		const file = entityImage(entity) ?? osmImage(tags.wikimedia_commons);
		if (file !== null) imageFiles.set(row.place.id, file);
	}
	const photos = await commons([...new Set(imageFiles.values())]);
	for (const row of unique) {
		const file = imageFiles.get(row.place.id);
		row.place.image = (file === undefined ? undefined : photos.images.get(file)) ?? null;
	}
	const places = z.array(placeSchema).parse(unique.map((row) => row.place).sort((a, b) => a.id.localeCompare(b.id)));
	const coverage = (count: number) => ({
		count,
		fraction: count / places.length,
		percent: Math.round((count / places.length) * 10000) / 100,
	});
	const tagNames = [...new Set(places.flatMap((place) => place.tags))].sort();
	const summary = {
		attribution: [
			'© участники OpenStreetMap, ODbL https://www.openstreetmap.org/copyright',
			'Wikidata, CC0 https://www.wikidata.org/wiki/Wikidata:Licensing',
			'Фотографии: Wikimedia Commons, автор и свободная лицензия указаны у каждого места (image.author, image.license, image.pageUrl)',
		],
		bbox,
		brandDescriptions: coverage(brandDescriptions),
		byCategory: Object.fromEntries(
			CATEGORIES.map((value) => [value, places.filter((place) => place.category === value).length]),
		),
		byTag: Object.fromEntries(
			tagNames.map((tag) => [tag, places.filter((place) => place.tags.includes(tag)).length]),
		),
		collectedAt: new Date().toISOString(),
		descriptions: coverage(places.filter((place) => place.description !== null).length),
		duplicatesByRule: Object.fromEntries(
			(['same_name', 'cross_language'] as const).map((rule) => [
				rule,
				merges.filter((merge) => merge.reason === rule).length,
			]),
		),
		duplicatesRemoved: merges.length,
		endpoint,
		excluded: exclusions,
		failedCommonsBatches: photos.failedBatches,
		failedWikidataBatches: failedBatches,
		generatedNames: generated.filter((item) => places.some((place) => place.id === item.id)).length,
		images: coverage(places.filter((place) => place.image !== null && place.image !== undefined).length),
		imagesSkipped: {
			missing: photos.skipped.filter((item) => item.reason === 'missing').length,
			notFree: photos.skipped.filter((item) => item.reason === 'not_free').length,
		},
		limitations: [
			'Выборка POI в bbox, не полный реестр Астаны. Гостиницы и посуточная аренда исключены.',
			'Безымянные детские и смотровые площадки названы шаблоном «Детская/Смотровая площадка, <ближайшая улица OSM ≤150 м>».',
			'Наличие opening_hours не означает проверенную актуальность или статус «открыто»; тег night не ставится статически.',
			'Описания могут быть краткими; «Сеть …» — описание бренда из Wikidata, не филиала. Популярность из числа sitelinks.',
			'Описания только на русском: английские и казахские описания Wikidata не используются, поле остаётся пустым.',
			'Связь OSM→Wikidata принимается, только если название или синоним элемента (ru/en/kk) делит с названием OSM слово от 4 букв или совпадает целиком; отклонённые связи — в collect_raw.json.',
			'Фото — только файл P18 своего элемента Wikidata или тег OSM wikimedia_commons=File:…, и только при лицензии CC0, CC BY, CC BY-SA или public domain.',
		],
		openingHours: coverage(places.filter((place) => place.openingHours !== null).length),
		osmBaseTimestamp: collected.osm3s.timestamp_osm_base,
		osmDescriptions: coverage(places.filter((place) => place.descriptionSource === 'osm').length),
		query,
		rawElements: collected.elements.length,
		startedAt,
		status: failedBatches === 0 && photos.failedBatches === 0 && streetResponse !== null ? 'complete' : 'partial',
		streetQuery,
		streets: streets.length,
		total: places.length,
		wikidataDescriptions: coverage(places.filter((place) => place.descriptionSource === 'wikidata').length),
		wikidataLinked: coverage(
			unique.filter(
				(row) =>
					valid(row.element.tags.wikidata) ||
					titleToId.has((row.element.tags.wikipedia ?? '').replaceAll('_', ' ')),
			).length,
		),
		wikidataPopularity: coverage(places.filter((place) => place.popularity !== null).length),
		wikidataRejected: rejectedMatches.length,
	};
	const sourceText = `${JSON.stringify(places, null, 2)}\n`;
	await publishCollection('data', {
		'collect_raw.json': `${JSON.stringify(
			{
				collectedAt: summary.collectedAt,
				commonsFiles: Object.fromEntries(imageFiles),
				commonsSkipped: photos.skipped,
				endpoint,
				generatedNames: generated,
				merges,
				overpass: collected,
				query,
				rejectedWikidataMatches: rejectedMatches,
				streetEndpoint: streetResponse?.endpoint ?? null,
				streetQuery,
				wikidata: Object.fromEntries(entities),
				wikipediaToWikidata: Object.fromEntries(titleToId),
			},
			null,
			2,
		)}\n`,
		'collect_summary.json': `${JSON.stringify(summary, null, 2)}\n`,
		'poi.json': sourceText,
		...sampleFiles({ collectedAt: summary.collectedAt, places, sourceText }),
	});
	console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error('Сбор завершился ошибкой. Проверьте подключение и повторите pnpm collect.', error);
		process.exitCode = 1;
	});
}
