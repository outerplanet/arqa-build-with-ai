'use client';

import { MapPinIcon } from '@heroicons/react/24/outline';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import { Callout } from '@shared/ui/Callout';
import { Card } from '@shared/ui/Card';
import { PlacesMap } from '@widgets/placesMap';
import { useMemo, useState } from 'react';
import { readPlacesResults } from '../model/results';
import { SCENARIOS } from '../model/scenarios';
import { useChat } from '../model/useChat';
import { AgentActivity } from './AgentActivity';
import { Composer } from './Composer';
import { LocationControl } from './LocationControl';
import { MessageList } from './MessageList';
import { PlaceCards } from './PlaceCards';

export interface ChatScreenProps {
	demoMode?: boolean;
	emptyHint?: string;
	placeholder?: string;
	subtitle?: string;
	title?: string;
}

export function ChatScreen({
	demoMode = false,
	emptyHint = 'Расскажите, где вы сейчас и сколько времени есть на прогулку.',
	placeholder = 'Например: я возле Mega Silk Way, хочу прогуляться 30–60 минут…',
	subtitle = 'Места рядом, время пешком и честные сведения из открытых городских данных.',
	title = 'Куда пойдём в Астане?',
}: ChatScreenProps) {
	const { error, location, messages, recommendedPlaceIds, retry, send, setLocation, status, toolCalls } = useChat();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const pending = status === 'sending';
	const { candidates, plan, search, walkingRoute } = useMemo(
		() => readPlacesResults(toolCalls, recommendedPlaceIds),
		[recommendedPlaceIds, toolCalls],
	);
	const origin =
		walkingRoute?.status === 'available'
			? (walkingRoute.legs[0]?.from ?? null)
			: (search?.origin.point ?? plan?.legs[0]?.from ?? null);
	const activeId = candidates.some((candidate) => candidate.place.id === selectedId) ? selectedId : null;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-start gap-3">
				<div className="bg-accent-subtle text-accent-fg flex size-12 shrink-0 items-center justify-center rounded-lg">
					<MapPinIcon aria-hidden className="size-6" />
				</div>
				<div>
					<p className="text-accent-fg mb-1 text-xs font-medium">ПРОГУЛКИ ПО АСТАНЕ</p>
					<h1 className="text-fg text-2xl font-semibold">{title}</h1>
					<p className="text-fg-muted mt-1 text-sm">{subtitle}</p>
					{demoMode && <Badge tone="warning">Демонстрационный режим</Badge>}
				</div>
			</div>

			<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="order-2 flex min-w-0 flex-col gap-4 xl:order-1">
					<Card
						className="min-h-[32rem] shrink-0"
						description="Укажите ориентир, интересы и время — ассистент проверит подходящие места"
						title="Ваша прогулка"
					>
						<LocationControl disabled={pending} location={location} onChange={setLocation} />
						{messages.length === 0 && (
							<div className="flex flex-col gap-2">
								<p className="text-fg-muted text-xs" id="scenario-hint">
									Примеры из кейса — нажмите, чтобы отправить. Запросы со значком{' '}
									<MapPinIcon aria-hidden className="inline size-3.5 align-text-bottom" /> ищут места рядом с
									вами: сначала нажмите «Использовать мою геолокацию» или напишите ориентир сами.
								</p>
								<div
									aria-describedby="scenario-hint"
									aria-label="Примеры запросов"
									className="flex flex-wrap gap-2"
									role="group"
								>
									{SCENARIOS.map((scenario) => (
										<Button
											// `!`: Button joins classes with clsx, not a merger, so its own
											// `whitespace-nowrap h-9` would otherwise win and a long chip overflows.
											className="h-auto! min-h-10 max-w-full justify-start py-2 text-left whitespace-normal!"
											disabled={pending}
											key={scenario.query}
											onClick={() => send(scenario.query)}
											variant="secondary"
										>
											{scenario.needsLocation && (
												<>
													<MapPinIcon aria-hidden className="size-4 shrink-0" />
													<span className="sr-only">Нужна геолокация: </span>
												</>
											)}
											{scenario.query}
										</Button>
									))}
								</div>
							</div>
						)}
						<div className="flex min-h-0 flex-1 flex-col gap-3">
							<MessageList emptyHint={emptyHint} messages={messages} pending={pending} />
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
							<Composer disabled={pending} onSend={send} placeholder={placeholder} />
						</div>
					</Card>
					<AgentActivity pending={pending} toolCalls={toolCalls} />
				</div>
				<div className="order-1 flex min-w-0 flex-col gap-4 xl:order-2">
					<PlacesMap
						candidates={candidates}
						error={error}
						onSelect={setSelectedId}
						origin={origin}
						pending={pending}
						plan={plan}
						selectedId={activeId}
						walkingRoute={walkingRoute}
					/>
					{search && (
						<div className="text-fg-muted text-xs">
							<p>
								Точка: {search.origin.label ?? 'переданная геолокация'} ·{' '}
								{search.origin.source === 'browser' ? 'из браузера' : 'из вашего сообщения'}
							</p>
							{search.usedFilters.length > 0 && (
								<p className="mt-1">Фильтры: {search.usedFilters.join(' · ')}</p>
							)}
							{search.note && <p className="mt-1">{search.note}</p>}
						</div>
					)}
					{candidates.length > 0 && plan === null && (
						<Button
							disabled={pending}
							onClick={() => send('Построй пеший маршрут на 2 часа.')}
							variant="secondary"
						>
							Маршрут на 2 часа
						</Button>
					)}
					{plan !== null && plan.stops.length > 0 && (
						<Callout>
							<p className="font-medium">
								{walkingRoute?.status === 'available' ? 'Маршрут' : 'Предварительная оценка'}:{' '}
								{plan.stops.length} {plan.stops.length === 1 ? 'остановка' : 'остановки'} · ≈{' '}
								{Math.ceil(
									walkingRoute?.status === 'available' ? walkingRoute.totalMinutes : plan.totalMinutes,
								)}{' '}
								мин
							</p>
							<p className="mt-1 text-sm">Включая переходы и посещения. {plan.note}</p>
							<p className="mt-1 text-sm">
								{walkingRoute?.status === 'available'
									? `${Math.round(walkingRoute.distanceM)} м по дорожкам · ≈ ${Math.ceil(walkingRoute.walkMinutes)} мин пешком.`
									: 'Пешеходный путь не проверен; навигационная линия не показана.'}
							</p>
						</Callout>
					)}
					<div className="hidden xl:block">
						<PlaceCards
							candidates={candidates}
							error={error}
							onRetry={retry}
							onSelect={setSelectedId}
							pending={pending}
							selectedId={activeId}
						/>
					</div>
				</div>
				<div className="order-3 min-w-0 xl:hidden">
					<PlaceCards
						candidates={candidates}
						error={error}
						onRetry={retry}
						onSelect={setSelectedId}
						pending={pending}
						selectedId={activeId}
					/>
				</div>
			</div>
		</div>
	);
}
