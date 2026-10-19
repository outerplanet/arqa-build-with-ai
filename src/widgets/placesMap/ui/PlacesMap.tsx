'use client';

import { type Candidate, type GeoPoint, type WalkPlan } from '@server/places/model/places.schema';
import { Button } from '@shared/ui/Button';
import { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { routeGeometry } from '../model/routeGeometry';
import styles from './PlacesMap.module.css';

export interface PlacesMapProps {
	candidates: readonly Candidate[];
	onSelect?: (id: string) => void;
	origin?: GeoPoint | null;
	pending?: boolean;
	plan?: WalkPlan | null;
	selectedId?: string | null;
}

const ROUTE_SOURCE = 'walk-route';

function mapStyle(): string {
	const { theme } = document.documentElement.dataset;
	const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
}

export function PlacesMap({ candidates, onSelect, origin, pending = false, plan, selectedId }: PlacesMapProps) {
	const container = useRef<HTMLDivElement>(null);
	const mapRef = useRef<MapLibreMap | null>(null);
	const fitted = useRef('');
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(0);
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let disposed = false;
		let map: MapLibreMap | undefined;
		let resize: ResizeObserver | undefined;
		let observer: MutationObserver | undefined;
		let removeThemeListener: (() => void) | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		void import('maplibre-gl')
			.then((library) => {
				if (disposed || !container.current) return;
				try {
					// MapLibre 6 requires an explicit worker asset when bundled by Next.js.
					library.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
					map = new library.Map({
						attributionControl: false,
						center: [71.43, 51.13],
						container: container.current,
						locale: { 'Map.MapFeedback': 'Сообщить об ошибке карты', 'Map.Title': 'Карта мест Астаны' },
						style: mapStyle(),
						zoom: 11,
					});
					mapRef.current = map;
					map.getCanvas().setAttribute(
						'aria-label',
						'Карта мест Астаны. Для выбора места доступны карточки ниже.',
					);
					timeout = setTimeout(() => {
						if (!disposed) setError(true);
					}, 20000);
					map.on('style.load', () => {
						if (disposed) return;
						setReady((value) => value + 1);
					});
					map.on('idle', () => {
						if (disposed) return;
						clearTimeout(timeout);
						setLoading(false);
						setError(false);
					});
					map.on('error', () => {
						if (!disposed) setError(true);
					});
					resize = new ResizeObserver(() => map?.resize());
					resize.observe(container.current);
					let currentStyle = mapStyle();
					const updateTheme = () => {
						const nextStyle = mapStyle();
						if (nextStyle === currentStyle) return;
						currentStyle = nextStyle;
						map?.setStyle(nextStyle);
					};
					observer = new MutationObserver(updateTheme);
					observer.observe(document.documentElement, { attributeFilter: ['data-theme'], attributes: true });
					const media = window.matchMedia('(prefers-color-scheme: dark)');
					media.addEventListener('change', updateTheme);
					removeThemeListener = () => media.removeEventListener('change', updateTheme);
				} catch {
					setError(true);
					setLoading(false);
				}
			})
			.catch(() => {
				if (!disposed) {
					setError(true);
					setLoading(false);
				}
			});
		return () => {
			disposed = true;
			clearTimeout(timeout);
			resize?.disconnect();
			observer?.disconnect();
			removeThemeListener?.();
			map?.remove();
			mapRef.current = null;
		};
	}, [attempt]);

	useEffect(() => {
		const map = mapRef.current;
		if (!map || !ready) return;
		let disposed = false;
		const markers: Marker[] = [];
		void import('maplibre-gl')
			.then((library) => {
				if (disposed) return;
				candidates.forEach((candidate, index) => {
					const element = document.createElement('button');
					element.type = 'button';
					element.className = styles.marker ?? '';
					element.textContent = String(index + 1);
					element.setAttribute('aria-label', `${index + 1}. ${candidate.place.name}. Показать карточку`);
					element.setAttribute('aria-pressed', String(candidate.place.id === selectedId));
					element.addEventListener('click', () => onSelect?.(candidate.place.id));
					markers.push(
						new library.Marker({ element }).setLngLat([candidate.place.lon, candidate.place.lat]).addTo(map),
					);
				});
				if (origin) {
					const element = document.createElement('div');
					element.className = styles.origin ?? '';
					element.setAttribute('role', 'img');
					element.setAttribute('aria-label', 'Точка начала поиска');
					markers.push(new library.Marker({ element }).setLngLat([origin.lon, origin.lat]).addTo(map));
				}
				const data = routeGeometry(plan);
				const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
				if (source) void source.setData(data);
				else {
					map.addSource(ROUTE_SOURCE, { data, type: 'geojson' });
					map.addLayer({
						id: ROUTE_SOURCE,
						paint: {
							'line-color': getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
							'line-dasharray': [2, 2],
							'line-width': 4,
						},
						source: ROUTE_SOURCE,
						type: 'line',
					});
				}
				const points: [number, number][] = candidates.map(({ place }) => [place.lon, place.lat]);
				if (origin) points.push([origin.lon, origin.lat]);
				for (const leg of plan?.legs ?? []) points.push([leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]);
				const signature = JSON.stringify(points);
				if (points.length && fitted.current !== signature) {
					fitted.current = signature;
					const bounds = points.reduce(
						(value, point) => value.extend(point),
						new library.LngLatBounds(points[0], points[0]),
					);
					map.fitBounds(bounds, {
						duration: 0,
						maxZoom: 15,
						padding: { bottom: 64, left: 56, right: 56, top: 84 },
					});
				}
			})
			.catch(() => {
				if (!disposed) setError(true);
			});
		return () => {
			disposed = true;
			markers.forEach((marker) => marker.remove());
		};
	}, [candidates, onSelect, origin, plan, ready, selectedId]);

	return (
		<section aria-label="Места и маршрут на карте" className={styles.map}>
			<div className={styles.canvas} ref={container} />
			<div aria-live="polite" className={styles.status}>
				{pending
					? 'Ищем места…'
					: loading
						? 'Загружаем карту…'
						: candidates.length
							? `${candidates.length} мест на карте`
							: 'Здесь появятся найденные места. Задайте вопрос в чате.'}
				{Boolean(plan?.legs.length) && <p>Пунктир — прямые отрезки, не пешеходная навигация.</p>}
			</div>
			<div aria-label="Масштаб карты" className={styles.controls}>
				<Button
					aria-label="Приблизить карту"
					onClick={() => mapRef.current?.zoomIn()}
					size="lg"
					variant="secondary"
				>
					+
				</Button>
				<Button aria-label="Отдалить карту" onClick={() => mapRef.current?.zoomOut()} size="lg" variant="secondary">
					−
				</Button>
			</div>
			{error && (
				<div className={styles.failure} role="status">
					<p>Карта недоступна. Места и ссылки на источники доступны в карточках.</p>
					<Button
						onClick={() => {
							setError(false);
							setLoading(true);
							fitted.current = '';
							setAttempt((value) => value + 1);
						}}
						size="lg"
						variant="secondary"
					>
						Повторить загрузку
					</Button>
				</div>
			)}
			<div className={styles.attribution}>
				<a href="https://openfreemap.org" rel="noreferrer" target="_blank">
					OpenFreeMap
				</a>
				{' · '}
				<a href="https://openmaptiles.org" rel="noreferrer" target="_blank">
					© OpenMapTiles
				</a>
				{' · '}
				<a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
					© участники OpenStreetMap
				</a>
			</div>
		</section>
	);
}
