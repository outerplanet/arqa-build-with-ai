'use client';

import { type Candidate, type GeoPoint, type WalkPlan } from '@server/places/model/places.schema';
import { Button } from '@shared/ui/Button';
import { type Map as LibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { routeGeometry } from '../model/routeGeometry';
import './PlacesMap.css';

export interface PlacesMapProps {
	candidates: readonly Candidate[];
	error: string | null;
	onSelect: (id: string) => void;
	origin: GeoPoint | null;
	pending: boolean;
	plan: WalkPlan | null;
	selectedId: string | null;
}

function routeColor(container: HTMLElement) {
	const sample = document.createElement('span');
	sample.style.color = 'var(--color-accent-bright)';
	container.append(sample);
	const { color } = getComputedStyle(sample);
	sample.remove();
	return color;
}

function mapStyle(): string {
	const { theme } = document.documentElement.dataset;
	const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
}

/** Receives only parsed tool results; it never resolves locations or invents route geometry. */
export function PlacesMap({ candidates, error, onSelect, origin, pending, plan, selectedId }: PlacesMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<LibreMap | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const [failed, setFailed] = useState(false);
	const hasPoints = candidates.length > 0 || origin !== null || (plan?.legs.length ?? 0) > 0;

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !hasPoints) return undefined;
		let cancelled = false;
		let map: LibreMap | null = null;
		let resize: ResizeObserver | null = null;
		let theme: MutationObserver | null = null;
		const scheme = window.matchMedia('(prefers-color-scheme: dark)');
		let currentStyle = mapStyle();
		const recolor = () => {
			const nextStyle = mapStyle();
			if (map && nextStyle !== currentStyle) {
				currentStyle = nextStyle;
				setReady(false);
				map.setStyle(nextStyle);
			}
			if (map?.getLayer('walk-route')) map.setPaintProperty('walk-route', 'line-color', routeColor(container));
		};
		// A failed style request must not leave an endless loading skeleton.
		const timeout = window.setTimeout(() => {
			if (!cancelled) setFailed(true);
		}, 20000);
		void import('maplibre-gl')
			.then((libre) => {
				if (cancelled) return;
				setReady(false);
				libre.setWorkerCount(1);
				// Emit the worker as a local asset; bundled module URLs cannot locate it implicitly.
				libre.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);
				map = new libre.Map({
					attributionControl: false,
					container,
					locale: {
						'Map.Title': 'Карта мест для прогулки',
						'Marker.Title': 'Место на карте',
						'NavigationControl.ResetBearing': 'Повернуть на север',
						'NavigationControl.ZoomIn': 'Приблизить',
						'NavigationControl.ZoomOut': 'Отдалить',
					},
					maxZoom: 18,
					style: currentStyle,
				});
				mapRef.current = map;
				map.addControl(new libre.NavigationControl({ showCompass: false }), 'top-right');
				map.on('style.load', () => {
					window.clearTimeout(timeout);
					if (!cancelled) {
						setFailed(false);
						setReady(true);
					}
				});
				map.on('error', () => {
					if (!cancelled) setFailed(true);
				});
				map.on('webglcontextlost', () => {
					if (!cancelled) setFailed(true);
				});
				resize = new ResizeObserver(() => map?.resize());
				resize.observe(container);
				theme = new MutationObserver(recolor);
				theme.observe(document.documentElement, { attributeFilter: ['data-theme'], attributes: true });
				scheme.addEventListener('change', recolor);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
			resize?.disconnect();
			theme?.disconnect();
			scheme.removeEventListener('change', recolor);
			mapRef.current = null;
			map?.remove();
		};
	}, [attempt, hasPoints]);

	useEffect(() => {
		const map = mapRef.current;
		const container = containerRef.current;
		if (!ready || !map || !container) return undefined;
		let cancelled = false;
		const markers: Marker[] = [];
		void import('maplibre-gl')
			.then((libre) => {
				if (cancelled) return;
				const bounds = new libre.LngLatBounds();
				for (const [index, candidate] of candidates.entries()) {
					const { place } = candidate;
					const selected = selectedId === place.id;
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'places-map-marker';
					button.textContent = String(index + 1);
					button.setAttribute('aria-label', `Место ${index + 1}: ${place.name}`);
					button.setAttribute('aria-pressed', String(selected));
					button.addEventListener('click', () => onSelect(place.id));
					markers.push(new libre.Marker({ element: button }).setLngLat([place.lon, place.lat]).addTo(map));
					bounds.extend([place.lon, place.lat]);
				}
				if (origin) {
					const label = document.createElement('span');
					label.className = 'places-map-origin';
					label.textContent = 'Старт';
					label.setAttribute('aria-label', 'Начало прогулки');
					markers.push(new libre.Marker({ element: label }).setLngLat([origin.lon, origin.lat]).addTo(map));
					bounds.extend([origin.lon, origin.lat]);
				}
				if (map.getLayer('walk-route')) map.removeLayer('walk-route');
				if (map.getSource('walk-route')) map.removeSource('walk-route');
				if (plan && plan.legs.length > 0) {
					for (const leg of plan.legs) {
						bounds.extend([leg.from.lon, leg.from.lat]);
						bounds.extend([leg.to.lon, leg.to.lat]);
					}
					map.addSource('walk-route', {
						data: routeGeometry(plan),
						type: 'geojson',
					});
					map.addLayer({
						id: 'walk-route',
						paint: { 'line-color': routeColor(container), 'line-dasharray': [2, 2], 'line-width': 4 },
						source: 'walk-route',
						type: 'line',
					});
				}
				if (!bounds.isEmpty()) map.fitBounds(bounds, { duration: 0, maxZoom: 15, padding: 56 });
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			for (const marker of markers) marker.remove();
		};
	}, [candidates, onSelect, origin, plan, ready, selectedId]);

	const retry = useCallback(() => {
		setFailed(false);
		setReady(false);
		setAttempt((value) => value + 1);
	}, []);

	return (
		<section aria-label="Карта прогулки" className="border-border bg-surface overflow-hidden rounded-lg border">
			<div className="places-map-frame">
				<div aria-label="Карта мест и маршрута" className="places-map-canvas" ref={containerRef} />
				{failed ? (
					<div className="places-map-state" role="status">
						<p>Карта недоступна. Места и расстояния можно посмотреть в карточках.</p>
						<Button onClick={retry} size="sm" variant="secondary">
							Повторить загрузку карты
						</Button>
					</div>
				) : error ? (
					<div className="places-map-state" role="status">
						Не удалось получить места. Повторите запрос в чате.
					</div>
				) : pending || (hasPoints && !ready) ? (
					<div aria-busy="true" className="places-map-state" role="status">
						Загружаем карту и места…
					</div>
				) : !hasPoints ? (
					<div className="places-map-state" role="status">
						Укажите, где вы находитесь, и попросите подобрать места.
					</div>
				) : candidates.length === 0 ? (
					<div className="places-map-caption" role="status">
						Мест пока нет. Попробуйте изменить запрос или расстояние.
					</div>
				) : null}
			</div>
			{plan && plan.legs.length > 0 && (
				<p className="border-border text-fg-muted border-t px-3 py-2 text-xs">Приблизительный маршрут по прямой</p>
			)}
			<p className="border-border text-fg-muted flex flex-wrap gap-x-2 border-t px-3 py-2 text-xs">
				<a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
					© участники OpenStreetMap
				</a>
				<a href="https://openfreemap.org/" rel="noreferrer" target="_blank">
					OpenFreeMap
				</a>
				<a href="https://openmaptiles.org/" rel="noreferrer" target="_blank">
					OpenMapTiles
				</a>
			</p>
		</section>
	);
}
