'use client';

import { MapPinIcon } from '@heroicons/react/24/outline';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import { Callout } from '@shared/ui/Callout';
import { Card } from '@shared/ui/Card';
import { PlacesMap } from '@widgets/placesMap';
import { useMemo, useState } from 'react';
import { readPlacesResults } from '../model/results';
import { useChat } from '../model/useChat';
import { AgentActivity } from './AgentActivity';
import { Composer } from './Composer';
import { LocationControl } from './LocationControl';
import { MessageList } from './MessageList';
import { PlaceCards } from './PlaceCards';

const SCENARIOS = [
	{ label: 'Необычное у Экспо', query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.' },
	{ label: 'Прогулка у Mega', query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.' },
	{ label: 'Тихое кафе', query: 'Хочу тихое место с кофе и розеткой недалеко от меня.' },
	{ label: 'С ребёнком', query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?' },
	{ label: 'До вылета', query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?' },
	{ label: 'Ночная прогулка', query: 'Ищу необычную ночную активность на последние пару часов.' },
] as const;

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
	placeholder = 'Я возле Mega Silk Way, хочу прогуляться на 60 минут…',
	subtitle = 'Места рядом, время пешком и честные сведения из открытых городских данных.',
	title = 'Куда пойдём в Астане?',
}: ChatScreenProps) {
	const { error, location, messages, recommendedPlaceIds, retry, send, setLocation, status, toolCalls } = useChat();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const pending = status === 'sending';
	const { candidates, plan, search } = useMemo(
		() => readPlacesResults(toolCalls, recommendedPlaceIds),
		[recommendedPlaceIds, toolCalls],
	);
	const origin = search?.origin.point ?? plan?.legs[0]?.from ?? null;
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
						className="min-h-[32rem]"
						description="Укажите ориентир, интересы и время — ассистент проверит подходящие места"
						title="Ваша прогулка"
					>
						<LocationControl disabled={pending} location={location} onChange={setLocation} />
						{messages.length === 0 && (
							<div aria-label="Примеры запросов" className="flex flex-wrap gap-2" role="group">
								{SCENARIOS.map((scenario) => (
									<Button
										className="h-auto min-h-10 text-left whitespace-normal"
										disabled={pending}
										key={scenario.label}
										onClick={() => send(scenario.query)}
										variant="secondary"
									>
										{scenario.label}
									</Button>
								))}
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
								Маршрут: {plan.stops.length} {plan.stops.length === 1 ? 'остановка' : 'остановки'} · ≈{' '}
								{plan.totalMinutes} мин
							</p>
							<p className="mt-1 text-sm">Включая переходы и посещения. {plan.note}</p>
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
