'use client';

import {
	CATEGORY_GROUP_ICON,
	CATEGORY_GROUP_LABEL,
	CATEGORY_GROUPS,
	categoryColorVar,
	type CategoryGroup,
	categoryGroup,
} from '@entities/place/model/category';
import { FlagIcon } from '@heroicons/react/20/solid';
import { type Candidate, type GeoPoint, type WalkPlan } from '@server/places/model/places.schema';
import { type WalkingRoute } from '@server/places/model/walkingRoute.schema';
import { Button } from '@shared/ui/Button';
import { type Map as LibreMap, type LngLatBounds, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nameLabelLayerIds } from '../model/localizeLabels';
import { routeGeometry } from '../model/routeGeometry';
import { formatSnapshotDate } from '../model/snapshotDate';
import { spreadMarkers } from '../model/spreadMarkers';
import './PlacesMap.css';

export interface PlacesMapProps {
	candidates: readonly Candidate[];
	error: string | null;
	onSelect: (id: string) => void;
	origin: GeoPoint | null;
	/** Text on the start marker: «Вы здесь» for a browser location, «Старт» otherwise. */
	originLabel?: string;
	pending: boolean;
	plan: WalkPlan | null;
	selectedId: string | null;
	walkingRoute: WalkingRoute | null;
}

interface MarkerHost {
	element: HTMLDivElement;
	id: string;
}

const START_ID = 'start';
/** Marker diameter plus a few pixels: closer markers are fanned out so each stays clickable. */
const MARKER_SPACING = 42;
const ROUTE_LAYERS = ['walk-route-arrows', 'walk-route-line', 'walk-route-casing'] as const;

/** MapLibre paints with plain colours, so read the semantic token at runtime instead of hard-coding it. */
function tokenColor(container: HTMLElement, token: string) {
	const sample = document.createElement('span');
	sample.style.color = `var(${token})`;
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

function reducedMotion() {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fitPadding(container: HTMLElement) {
	// Room for a whole marker (and its fanned-out neighbours) inside the frame; the zoom buttons sit
	// top-right, and a label hangs below a marker.
	const side = Math.round(Math.max(44, Math.min(72, container.clientWidth * 0.1)));
	return { bottom: side + 24, left: side, right: side + 24, top: side + 8 };
}

/** A chevron pointing along +x; MapLibre rotates it with the line, so it shows walking direction. */
function arrowImage(color: string) {
	const size = 24;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.strokeStyle = color;
	context.lineWidth = 3;
	context.lineCap = 'round';
	context.lineJoin = 'round';
	context.beginPath();
	context.moveTo(9, 6);
	context.lineTo(15, 12);
	context.lineTo(9, 18);
	context.stroke();
	return context.getImageData(0, 0, size, size);
}

function stopHint(candidate: Candidate, plan: WalkPlan | null) {
	const stop = plan?.stops.find((item) => item.candidate.place.id === candidate.place.id);
	return stop
		? `на маршруте ≈ ${Math.ceil(stop.arriveAtMinute)} мин`
		: `≈ ${Math.ceil(candidate.walkMinutes)} мин пешком`;
}

/** Receives only parsed tool results; it never resolves locations or invents route geometry. */
export function PlacesMap({
	candidates,
	error,
	onSelect,
	origin,
	originLabel = 'Старт',
	pending,
	plan,
	selectedId,
	walkingRoute,
}: PlacesMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<LibreMap | null>(null);
	const markersRef = useRef(new Map<string, Marker>());
	const boundsRef = useRef<LngLatBounds | null>(null);
	const fittedRef = useRef(false);
	const userMovedRef = useRef(false);
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const [failed, setFailed] = useState(false);
	const [hosts, setHosts] = useState<MarkerHost[]>([]);
	const hasPoints = candidates.length > 0 || origin !== null || (plan?.legs.length ?? 0) > 0;

	const startPoint = walkingRoute?.status === 'available' ? (walkingRoute.legs[0]?.from ?? null) : origin;
	const startLat = startPoint?.lat ?? null;
	const startLon = startPoint?.lon ?? null;

	const layoutMarkers = useCallback(() => {
		const map = mapRef.current;
		if (!map) return;
		const entries = [...markersRef.current.entries()];
		const offsets = spreadMarkers(
			entries.map(([id, marker]) => {
				const point = map.project(marker.getLngLat());
				return { id, x: point.x, y: point.y };
			}),
			MARKER_SPACING,
		);
		for (const [id, marker] of entries) {
			const offset = offsets.get(id);
			if (offset) marker.setOffset([offset.dx, offset.dy]);
		}
	}, []);

	const fitCamera = useCallback((animate: boolean) => {
		const map = mapRef.current;
		const container = containerRef.current;
		const bounds = boundsRef.current;
		if (!map || !container || !bounds || bounds.isEmpty()) return;
		map.fitBounds(bounds, {
			duration: animate && !reducedMotion() ? 700 : 0,
			maxZoom: 16,
			padding: fitPadding(container),
		});
	}, []);

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
				// A diffed swap does not emit style.load and drops our layers; reload the style fully.
				map.setStyle(nextStyle, { diff: false });
			}
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
				const created = new libre.Map({
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
				map = created;
				mapRef.current = created;
				fittedRef.current = false;
				created.addControl(new libre.NavigationControl({ showCompass: false }), 'top-right');
				created.on('style.load', () => {
					window.clearTimeout(timeout);
					// Base-map labels in Russian where OpenStreetMap has a Russian name.
					for (const id of nameLabelLayerIds(created.getStyle().layers)) {
						created.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:ru'], ['get', 'name']]);
					}
					if (!cancelled) {
						setFailed(false);
						setReady(true);
					}
				});
				created.on('move', layoutMarkers);
				created.on('movestart', (event: { originalEvent?: unknown }) => {
					if (event.originalEvent) userMovedRef.current = true;
				});
				created.on('error', () => {
					if (!cancelled) setFailed(true);
				});
				created.on('webglcontextlost', () => {
					if (!cancelled) setFailed(true);
				});
				resize = new ResizeObserver(() => {
					created.resize();
					// Until the visitor moves the map, keep every point in view as the layout settles.
					if (!userMovedRef.current) fitCamera(false);
					layoutMarkers();
				});
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
	}, [attempt, fitCamera, hasPoints, layoutMarkers]);

	// Markers: DOM hosts owned by MapLibre, contents rendered by React through portals.
	useEffect(() => {
		const map = mapRef.current;
		if (!ready || !map) return undefined;
		let cancelled = false;
		const created = new Map<string, Marker>();
		void import('maplibre-gl')
			.then((libre) => {
				if (cancelled) return;
				const next: MarkerHost[] = [];
				const add = (id: string, point: [number, number]) => {
					const element = document.createElement('div');
					element.className = id === START_ID ? 'places-map-host is-start' : 'places-map-host';
					created.set(id, new libre.Marker({ element }).setLngLat(point).addTo(map));
					next.push({ element, id });
				};
				if (startLat !== null && startLon !== null) add(START_ID, [startLon, startLat]);
				for (const { place } of candidates) add(place.id, [place.lon, place.lat]);
				markersRef.current = created;
				layoutMarkers();
				setHosts(next);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			for (const marker of created.values()) marker.remove();
			markersRef.current = new Map();
			setHosts([]);
		};
	}, [candidates, layoutMarkers, ready, startLat, startLon]);

	// Route: only the pedestrian geometry returned by the tool, styled with the accent token.
	useEffect(() => {
		const map = mapRef.current;
		const container = containerRef.current;
		if (!ready || !map || !container) return undefined;
		const clear = () => {
			try {
				for (const layer of ROUTE_LAYERS) if (map.getLayer(layer)) map.removeLayer(layer);
				if (map.getSource('walk-route')) map.removeSource('walk-route');
			} catch {
				// The map was already removed together with its style.
			}
		};
		clear();
		if (walkingRoute?.status !== 'available') return clear;
		const surface = tokenColor(container, '--color-surface');
		map.addSource('walk-route', { data: routeGeometry(walkingRoute), type: 'geojson' });
		map.addLayer({
			id: 'walk-route-casing',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-color': surface, 'line-width': 9 },
			source: 'walk-route',
			type: 'line',
		});
		map.addLayer({
			id: 'walk-route-line',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-color': tokenColor(container, '--color-accent'), 'line-width': 5 },
			source: 'walk-route',
			type: 'line',
		});
		const arrow = arrowImage(surface);
		if (arrow) {
			if (map.hasImage('walk-arrow')) map.removeImage('walk-arrow');
			map.addImage('walk-arrow', arrow, { pixelRatio: 2 });
			map.addLayer({
				id: 'walk-route-arrows',
				layout: {
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
					'icon-image': 'walk-arrow',
					'icon-rotation-alignment': 'map',
					'symbol-placement': 'line',
					'symbol-spacing': 80,
				},
				source: 'walk-route',
				type: 'symbol',
			});
		}
		return clear;
	}, [ready, walkingRoute]);

	// Camera: start, every recommended place and the route geometry, framed with padding.
	useEffect(() => {
		const map = mapRef.current;
		if (!ready || !map) return;
		void import('maplibre-gl').then((libre) => {
			const bounds = new libre.LngLatBounds();
			if (startLat !== null && startLon !== null) bounds.extend([startLon, startLat]);
			for (const { place } of candidates) bounds.extend([place.lon, place.lat]);
			if (walkingRoute?.status === 'available') {
				for (const leg of walkingRoute.legs)
					for (const coordinate of leg.geometry.coordinates) bounds.extend(coordinate);
			}
			boundsRef.current = bounds.isEmpty() ? null : bounds;
			userMovedRef.current = false;
			fitCamera(fittedRef.current);
			fittedRef.current = true;
		});
	}, [candidates, fitCamera, ready, startLat, startLon, walkingRoute]);

	// Selecting a card (or a marker) brings that place to the centre.
	const lastSelected = useRef<string | null>(null);
	useEffect(() => {
		const map = mapRef.current;
		if (!ready || !map || selectedId === lastSelected.current) return;
		lastSelected.current = selectedId;
		const place = candidates.find((candidate) => candidate.place.id === selectedId)?.place;
		if (!place) return;
		map.easeTo({
			center: [place.lon, place.lat],
			duration: reducedMotion() ? 0 : 600,
			zoom: Math.max(map.getZoom(), 15),
		});
	}, [candidates, ready, selectedId]);

	useEffect(() => {
		for (const host of hosts) host.element.classList.toggle('is-selected', host.id === selectedId);
	}, [hosts, selectedId]);

	const retry = useCallback(() => {
		setFailed(false);
		setReady(false);
		setAttempt((value) => value + 1);
	}, []);

	const groups = useMemo(() => {
		const present = new Set(candidates.map((candidate) => categoryGroup(candidate.place.category)));
		return CATEGORY_GROUPS.filter((group) => present.has(group));
	}, [candidates]);
	const snapshot = walkingRoute?.status === 'available' ? formatSnapshotDate(walkingRoute.collectedAt) : null;
	const byId = new Map(candidates.map((candidate, index) => [candidate.place.id, { candidate, order: index + 1 }]));

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
			{hosts.map((host) => {
				if (host.id === START_ID) {
					return createPortal(
						<span aria-label={`Начало прогулки: ${originLabel}`} className="places-map-start" role="img">
							<FlagIcon aria-hidden="true" className="size-3.5" />
							{originLabel}
						</span>,
						host.element,
						host.id,
					);
				}
				const entry = byId.get(host.id);
				if (!entry) return null;
				const { candidate, order } = entry;
				const group = categoryGroup(candidate.place.category);
				const Icon = CATEGORY_GROUP_ICON[group];
				const selected = selectedId === host.id;
				const hint = stopHint(candidate, plan);
				return createPortal(
					<button
						aria-label={`${plan ? 'Остановка' : 'Место'} ${order}: ${candidate.place.name}, ${CATEGORY_GROUP_LABEL[group]}, ${hint}`}
						aria-pressed={selected}
						className="places-map-pin"
						onClick={() => onSelect(candidate.place.id)}
						style={{ '--pin-color': `var(${categoryColorVar(group)})` } as CSSProperties}
						type="button"
					>
						<span aria-hidden="true" className="places-map-pin-dot">
							<Icon className="size-[18px]" />
						</span>
						<span aria-hidden="true" className="places-map-pin-order">
							{order}
						</span>
						<span aria-hidden="true" className="places-map-pin-label">
							<span className="places-map-pin-name">{candidate.place.name}</span>
							<span className="places-map-pin-hint">{hint}</span>
						</span>
					</button>,
					host.element,
					host.id,
				);
			})}
			{(groups.length > 0 || startPoint !== null) && (
				<ul
					aria-label="Обозначения на карте"
					className="places-map-legend border-border border-t px-3 py-2 text-xs"
				>
					{startPoint !== null && (
						<li>
							<span aria-hidden="true" className="places-map-legend-start">
								<FlagIcon className="size-3" />
							</span>
							{originLabel}
						</li>
					)}
					{groups.map((group: CategoryGroup) => {
						const Icon = CATEGORY_GROUP_ICON[group];
						return (
							<li key={group}>
								<span
									aria-hidden="true"
									className="places-map-legend-swatch"
									style={{ '--pin-color': `var(${categoryColorVar(group)})` } as CSSProperties}
								>
									<Icon className="size-3" />
								</span>
								{CATEGORY_GROUP_LABEL[group]}
							</li>
						);
					})}
					{walkingRoute?.status === 'available' && (
						<li>
							<span aria-hidden="true" className="places-map-legend-route" />
							Пешеходный путь
						</li>
					)}
				</ul>
			)}
			{plan && (
				<p className="border-border text-fg-muted border-t px-3 py-2 text-xs">
					{walkingRoute?.status === 'available'
						? `Пешеходная сеть OpenStreetMap${snapshot ? `, снимок ${snapshot}` : ''}. Входы и лестницы проверьте на месте.`
						: `Пешеходный путь не подтверждён, линия не показана. ${walkingRoute?.note ?? 'Проверьте путь и входы перед выходом.'}`}
				</p>
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
