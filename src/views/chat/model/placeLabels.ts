import { type Category, type Place } from '@server/places/model/places.schema';

export const CATEGORY_LABELS: Record<Category, string> = {
	artwork: 'Арт-объект',
	attraction: 'Достопримечательность',
	bar: 'Бар',
	cafe: 'Кафе',
	cinema: 'Кинотеатр',
	fast_food: 'Быстрое питание',
	gallery: 'Галерея',
	garden: 'Сад',
	library: 'Библиотека',
	mall: 'Торговый центр',
	monument: 'Памятник',
	museum: 'Музей',
	nightclub: 'Ночной клуб',
	other: 'Городское место',
	park: 'Парк',
	place_of_worship: 'Религиозный объект',
	playground: 'Детская площадка',
	restaurant: 'Ресторан',
	sports: 'Спорт',
	theatre: 'Театр',
	theme_park: 'Парк развлечений',
	viewpoint: 'Смотровая площадка',
	zoo: 'Зоопарк',
};

export function formatDistance(distanceM: number): string {
	return distanceM >= 1000
		? `${(distanceM / 1000).toFixed(1).replace('.', ',')} км`
		: `${String(Math.round(distanceM))} м`;
}

function hostIs(raw: string, domain: string): URL | null {
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase();
		return url.protocol === 'https:' && (host === domain || host.endsWith(`.${domain}`)) ? url : null;
	} catch {
		return null;
	}
}

/** The Commons file hosts `next.config.mjs` lets the image optimiser fetch — keep the two in step. */
const COMMONS_FILE_HOSTS = new Set(['thumb.wikimedia.org', 'upload.wikimedia.org']);

/**
 * A Wikimedia Commons photo the card may show. The file must be on one of the Commons file hosts
 * under /wikipedia/commons/, and its attribution page on wikimedia.org; anything else falls back to
 * the category tile rather than to an arbitrary URL.
 *
 * The returned `url` has its query string removed: Commons thumbnails arrive with `utm_*` tracking
 * parameters, and the optimiser's `remotePatterns` only accept a URL with no query at all.
 */
export function commonsImage(place: Place): NonNullable<Place['image']> | null {
	const { image } = place;
	if (!image) return null;
	let file: URL;
	try {
		file = new URL(image.url);
	} catch {
		return null;
	}
	const page = hostIs(image.pageUrl, 'wikimedia.org');
	if (
		file.protocol !== 'https:' ||
		file.port !== '' ||
		!COMMONS_FILE_HOSTS.has(file.hostname.toLowerCase()) ||
		!file.pathname.startsWith('/wikipedia/commons/') ||
		page === null
	)
		return null;
	return { ...image, url: `${file.origin}${file.pathname}` };
}
