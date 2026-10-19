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

/**
 * A Wikimedia Commons photo the card may show. The file must be on upload.wikimedia.org — the
 * only host `next.config.mjs` lets the image optimiser fetch — and its attribution page on
 * wikimedia.org; anything else falls back to the category tile rather than to an arbitrary URL.
 */
export function commonsImage(place: Place): NonNullable<Place['image']> | null {
	const { image } = place;
	if (!image) return null;
	const file = hostIs(image.url, 'upload.wikimedia.org');
	const page = hostIs(image.pageUrl, 'wikimedia.org');
	return file !== null && file.pathname.startsWith('/wikipedia/commons/') && page !== null ? image : null;
}
