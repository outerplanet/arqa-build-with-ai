'use client';

import { type GeoPoint } from '@server/places/model/places.schema';
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
import { LocationConsent } from './LocationConsent';
import { MessageList } from './MessageList';
import { PlaceCards } from './PlaceCards';

const SCENARIOS = [
	{ label: 'Необычное у Экспо', query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.' },
	{ label: 'Прогулка у Mega', query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.' },
	{ label: 'Кофе и розетка', query: 'Хочу тихое место с кофе и розеткой недалеко от меня.' },
	{ label: 'С ребёнком', query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?' },
	{ label: 'Перед вылетом', query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?' },
	{ label: 'Астана ночью', query: 'Что необычного рядом со мной можно посмотреть ночью и что сейчас открыто?' },
];
export interface ChatScreenProps {
	demoMode?: boolean;
	emptyHint?: string;
	placeholder?: string;
	subtitle?: string;
	title?: string;
}

export function ChatScreen({
	demoMode = false,
	emptyHint = 'Назовите ориентир, интересы и сколько у вас времени.',
	placeholder = 'Например: я у Экспо, есть час на прогулку…',
	subtitle = 'Места рядом, честные часы работы и короткий маршрут пешком.',
	title = 'Куда пойдём в Астане?',
}: ChatScreenProps) {
	const { error, messages, recommendedPlaceIds, retry, send, status, toolCalls } = useChat();
	const [location, setLocation] = useState<GeoPoint>();
	const [selection, setSelection] = useState<string | null>(null);
	const results = useMemo(() => readPlacesResults(toolCalls, recommendedPlaceIds), [recommendedPlaceIds, toolCalls]);
	const pending = status === 'sending';
	const selectedId = results.candidates.some((candidate) => candidate.place.id === selection) ? selection : null;
	const sendMessage = (content: string) => send(content, location);
	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-accent-fg mb-2 text-xs font-semibold tracking-widest uppercase">
						Город ближе, чем кажется
					</p>
					<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
					<p className="text-fg-muted mt-2 text-sm">{subtitle}</p>
				</div>
				{demoMode && <Badge tone="warning">Демонстрационный режим</Badge>}
			</div>
			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
				<div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
					<Card description="Расскажите, где вы и что вам интересно" title="Ваша прогулка">
						<LocationConsent location={location} onChange={setLocation} />
						{messages.length === 0 && (
							<div aria-label="Примеры запросов" className="flex flex-wrap gap-2">
								{SCENARIOS.map((scenario) => (
									<Button
										className="min-h-10 max-w-full text-left text-sm whitespace-normal"
										disabled={pending}
										key={scenario.label}
										onClick={() => sendMessage(scenario.query)}
										variant="secondary"
									>
										{scenario.label}
									</Button>
								))}
							</div>
						)}
						<div className="flex min-h-56 flex-col">
							<MessageList emptyHint={emptyHint} messages={messages} pending={pending} />
						</div>
						{error && (
							<Callout tone="danger">
								<div className="flex flex-wrap items-center gap-2" role="alert">
									<span>{error}</span>
									<Button onClick={() => retry(location)} variant="secondary">
										Повторить
									</Button>
								</div>
							</Callout>
						)}
						<Composer disabled={pending} onSend={sendMessage} placeholder={placeholder} />
					</Card>
					<AgentActivity pending={pending} toolCalls={toolCalls} />
				</div>
				<div className="contents lg:order-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
					<div className="order-1 min-w-0">
						<PlacesMap
							candidates={results.candidates}
							onSelect={setSelection}
							origin={results.search?.origin.point ?? results.plan?.legs[0]?.from ?? null}
							pending={pending}
							plan={results.plan}
							selectedId={selectedId}
						/>
					</div>
					<section
						aria-busy={pending}
						aria-label="Найденные места"
						className="order-3 flex min-w-0 flex-col gap-3"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="font-semibold">
								{results.plan ? 'Остановки маршрута' : 'Места для вашей прогулки'}
							</h2>
							{results.candidates.length > 0 && !results.plan && (
								<Button
									className="min-h-10 text-sm"
									disabled={pending}
									onClick={() => sendMessage('Построй пеший маршрут на 2 часа.')}
									variant="secondary"
								>
									Маршрут на 2 часа
								</Button>
							)}
						</div>
						{pending && (
							<p className="text-fg-muted text-sm" role="status">
								Ищем места и проверяем данные… Предыдущие результаты пока остаются на карте.
							</p>
						)}
						{results.search && (
							<div className="text-fg-muted text-xs">
								<p>
									Точка: {results.search.origin.label ?? 'переданная геолокация'} ·{' '}
									{results.search.origin.source === 'browser' ? 'из браузера' : 'из вашего сообщения'}
								</p>
								{results.search.usedFilters.length > 0 && (
									<p className="mt-1">Фильтры: {results.search.usedFilters.join(' · ')}</p>
								)}
								{results.search.note && <p className="mt-1">{results.search.note}</p>}
							</div>
						)}
						{results.plan && (
							<Callout tone="info">
								<p className="font-medium">
									Маршрут: {results.plan.stops.length} остановки · {Math.ceil(results.plan.totalMinutes)} мин
								</p>
								<p className="mt-1 text-sm">
									{results.plan.note} Расстояния и линия — по прямой, проверьте проходы на месте.
								</p>
							</Callout>
						)}
						{results.candidates.length === 0 ? (
							<div className="border-border bg-surface text-fg-muted rounded-lg border p-5 text-sm">
								{results.search
									? 'По этим условиям подходящих мест не найдено. Попробуйте другой интерес или увеличьте время прогулки.'
									: 'После запроса здесь появятся места из OpenStreetMap и Wikidata. Начните с примера или напишите свой маршрут.'}
							</div>
						) : (
							<PlaceCards candidates={results.candidates} onSelect={setSelection} selectedId={selectedId} />
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
