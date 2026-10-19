'use client';

import { CATEGORY_GROUP_ICON } from '@entities/place/model/category';
import { MapIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import { Callout } from '@shared/ui/Callout';
import { Card } from '@shared/ui/Card';
import { PlacesMap } from '@widgets/placesMap';
import clsx from 'clsx';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPlaceCards, summariseReply } from '../model/reply';
import { readPlacesResults, readResolvedLocation } from '../model/results';
import { SCENARIOS } from '../model/scenarios';
import { useChat } from '../model/useChat';
import { AgentActivity } from './AgentActivity';
import { AssistantReply } from './AssistantReply';
import { CATEGORY_TILE } from './categoryClasses';
import { Composer } from './Composer';
import { LocationControl } from './LocationControl';
import { MessageList } from './MessageList';
import { PlaceList } from './PlaceList';

export interface ChatScreenProps {
	demoMode?: boolean;
	emptyHint?: string;
	placeholder?: string;
	subtitle?: string;
	title?: string;
}

/** The map sits beside the chat from this width; below it the map is above and must be scrolled to. */
const SIDE_BY_SIDE = '(min-width: 1280px)';

/** Whether the element is at least partly on screen; true until measured, so nothing flashes. */
function useInView(ref: RefObject<HTMLElement | null>): boolean {
	const [visible, setVisible] = useState(true);
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof IntersectionObserver === 'undefined') return undefined;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return visible;
}

export function ChatScreen({
	demoMode = false,
	emptyHint = 'Выберите пример выше или напишите, где вы и сколько у вас времени.',
	placeholder = 'Например: я возле Mega Silk Way, хочу прогуляться 30–60 минут…',
	subtitle = 'Скажите, где вы и чего хочется, — подберу 1–3 места рядом: сколько идти, почему туда и честно про часы работы.',
	title = 'Куда пойдём в Астане?',
}: ChatScreenProps) {
	const {
		error,
		location,
		messages,
		recommendations,
		recommendedPlaceIds,
		replyIndex,
		retry,
		send,
		setLocation,
		status,
		toolCalls,
	} = useChat();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const mapRef = useRef<HTMLDivElement>(null);
	const pending = status === 'sending';
	const { candidates, plan, search, walkingRoute } = useMemo(
		() => readPlacesResults(toolCalls, recommendedPlaceIds),
		[recommendedPlaceIds, toolCalls],
	);
	const replyText = messages[replyIndex]?.role === 'assistant' ? messages[replyIndex].content : '';
	const cards = useMemo(
		() => buildPlaceCards({ candidates, recommendations, reply: replyText, walkingRoute }),
		[candidates, recommendations, replyText, walkingRoute],
	);
	const resolved = useMemo(() => readResolvedLocation(toolCalls), [toolCalls]);
	const summary = useMemo(
		() => summariseReply({ count: cards.length, plan, reply: replyText, resolved, search, walkingRoute }),
		[cards.length, plan, replyText, resolved, search, walkingRoute],
	);
	const mapVisible = useInView(mapRef);
	const origin =
		walkingRoute?.status === 'available'
			? (walkingRoute.legs[0]?.from ?? null)
			: (search?.origin.point ?? plan?.legs[0]?.from ?? null);
	const activeId = candidates.some((candidate) => candidate.place.id === selectedId) ? selectedId : null;

	const jumpToMap = useCallback(() => {
		mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}, []);

	const showOnMap = useCallback(
		(id: string) => {
			setSelectedId(id);
			// On a phone the map is above the conversation: bring it into view, or the tap looks dead.
			if (!window.matchMedia(SIDE_BY_SIDE).matches) jumpToMap();
		},
		[jumpToMap],
	);

	const richReply =
		search !== null || plan !== null ? (
			<AssistantReply
				cards={cards}
				disabled={pending}
				onShow={showOnMap}
				reply={replyText}
				selectedId={activeId}
				summary={summary}
			/>
		) : null;

	return (
		<div className="flex flex-col gap-5">
			{/* A two-stop tint of the semantic accent ground: decoration that follows the theme. */}
			<section
				aria-labelledby="hero-title"
				className="border-border from-accent-subtle via-surface to-surface flex flex-col gap-5 rounded-lg border bg-linear-to-br p-5 md:p-7"
			>
				<div className="flex items-start gap-4">
					<div className="bg-accent text-on-accent hidden size-14 shrink-0 items-center justify-center rounded-lg sm:flex">
						<MapIcon aria-hidden className="size-7" />
					</div>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<p className="text-accent-fg text-xs font-semibold tracking-wider uppercase">Прогулки по Астане</p>
							{demoMode && <Badge tone="warning">Демонстрационный режим</Badge>}
						</div>
						<h1 className="text-fg mt-1 text-2xl leading-tight font-bold md:text-3xl" id="hero-title">
							{title}
						</h1>
						<p className="text-fg-muted text-md mt-2 max-w-2xl">{subtitle}</p>
					</div>
				</div>

				<LocationControl disabled={pending} location={location} onChange={setLocation} />

				{messages.length === 0 && (
					<div className="flex flex-col gap-2">
						<p className="text-fg-muted text-sm" id="scenario-hint">
							Примеры из кейса — нажмите, чтобы отправить. Со значком{' '}
							<MapPinIcon aria-hidden className="inline size-3.5 align-text-bottom" /> ищут рядом с вами: сначала
							включите геолокацию или напишите ориентир.
						</p>
						<ul
							aria-describedby="scenario-hint"
							aria-label="Примеры запросов"
							className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
						>
							{SCENARIOS.map((scenario) => {
								const Icon = CATEGORY_GROUP_ICON[scenario.group];
								return (
									<li className="flex" key={scenario.query}>
										<Button
											className="h-auto w-full items-start justify-start gap-3 rounded-lg p-3 text-left whitespace-normal"
											disabled={pending}
											onClick={() => send(scenario.query)}
											variant="secondary"
										>
											<span
												aria-hidden
												className={clsx(
													'flex size-10 shrink-0 items-center justify-center rounded-md',
													CATEGORY_TILE[scenario.group],
												)}
											>
												<Icon className="size-5" />
											</span>
											<span className="flex min-w-0 flex-col gap-0.5">
												<span className="text-fg flex items-center gap-1 font-semibold">
													{scenario.title}
													{scenario.needsLocation && (
														<>
															<MapPinIcon aria-hidden className="text-fg-subtle size-3.5 shrink-0" />
															<span className="sr-only">(нужна геолокация)</span>
														</>
													)}
												</span>
												<span className="text-fg-muted text-sm font-normal">{scenario.query}</span>
											</span>
										</Button>
									</li>
								);
							})}
						</ul>
					</div>
				)}
			</section>

			<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
				<div className="order-2 flex min-w-0 flex-col gap-4 xl:order-1">
					<Card className="min-h-[24rem] shrink-0" title="Ваша прогулка">
						<div className="flex min-h-0 flex-1 flex-col gap-3">
							<MessageList
								emptyHint={emptyHint}
								messages={messages}
								pending={pending}
								reply={richReply}
								replyIndex={replyIndex}
							/>
							{error !== null && (
								<Callout tone="danger">
									<div className="flex flex-wrap items-center gap-2">
										<span>{error}</span>
										<Button onClick={retry} variant="secondary">
											Повторить
										</Button>
									</div>
								</Callout>
							)}
							{candidates.length > 0 && plan === null && (
								<Button
									className="self-start"
									disabled={pending}
									onClick={() => send('Построй пеший маршрут на 2 часа.')}
									variant="secondary"
								>
									Построить маршрут на 2 часа
								</Button>
							)}
							<Composer disabled={pending} onSend={send} placeholder={placeholder} />
						</div>
					</Card>
					<AgentActivity
						pending={pending}
						shownIds={candidates.map((candidate) => candidate.place.id)}
						toolCalls={toolCalls}
					/>
				</div>

				<div className="order-1 flex min-w-0 flex-col gap-3 xl:sticky xl:top-4 xl:order-2 xl:self-start">
					<div className="scroll-mt-4" ref={mapRef}>
						<PlacesMap
							candidates={candidates}
							error={error}
							onSelect={setSelectedId}
							origin={origin}
							originLabel={summary.source === 'геолокация браузера' ? 'Вы здесь' : 'Старт'}
							pending={pending}
							plan={plan}
							selectedId={activeId}
							walkingRoute={walkingRoute}
						/>
					</div>
					{plan !== null && plan.stops.length > 0 && (
						<Callout>
							<p className="font-medium">
								{walkingRoute?.status === 'available' ? 'Маршрут' : 'Предварительная оценка'}:{' '}
								{walkingRoute?.status === 'available'
									? `${String(Math.round(walkingRoute.distanceM))} м по дорожкам · ≈ ${String(Math.ceil(walkingRoute.walkMinutes))} мин пешком`
									: 'пешеходный путь не проверен; навигационная линия не показана'}
							</p>
						</Callout>
					)}
					<PlaceList
						cards={cards}
						error={error}
						onSelect={setSelectedId}
						pending={pending}
						selectedId={activeId}
					/>
				</div>
			</div>

			{/* Below the side-by-side width the map is far above the answer: one tap brings it back. */}
			{cards.length > 0 && !mapVisible && (
				<Button
					className="fixed right-4 bottom-4 z-20 rounded-full shadow-lg xl:hidden"
					onClick={jumpToMap}
					size="lg"
				>
					<MapIcon aria-hidden className="size-5" />
					Карта
				</Button>
			)}
		</div>
	);
}
