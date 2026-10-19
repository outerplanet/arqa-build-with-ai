import { type GeoPoint } from '@server/places/model/places.schema';

/**
 * Plain outbound links that open the same place in the navigation apps people in Astana use.
 *
 * Nothing is read from those services: the product's data stays OpenStreetMap and Wikidata, and
 * these are only searches by the place's name, centred on its OSM coordinates.
 *
 * Formats, checked on 2026-10-19:
 * - 2GIS web: `https://2gis.kz/astana/search/<query>?m=<lon>,<lat>/<zoom>` — the city search page;
 *   `m` centres the map (longitude first). Answers 200 for a Latin and a Cyrillic query.
 * - Yandex Maps web: `https://yandex.kz/maps/?text=<query>&ll=<lon>,<lat>&z=<zoom>` — documented in
 *   «Launch web version of Yandex Maps» (yandex.com/dev/yandex-apps-launch-maps): `text` is the
 *   search, `ll` the centre as longitude,latitude, `z` the zoom 1–19.
 */
const ZOOM = 17;

function coordinates({ lat, lon }: GeoPoint): string {
	return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

export function twoGisUrl(name: string, point: GeoPoint): string {
	return `https://2gis.kz/astana/search/${encodeURIComponent(name)}?m=${encodeURIComponent(`${coordinates(point)}/${String(ZOOM)}`)}`;
}

export function yandexMapsUrl(name: string, point: GeoPoint): string {
	const query = new URLSearchParams({ ll: coordinates(point), text: name, z: String(ZOOM) });
	return `https://yandex.kz/maps/?${query.toString()}`;
}
