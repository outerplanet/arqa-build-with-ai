'use client';

import { type Candidate, type Category } from '@server/places/model/places.schema';
import { type WalkingRoute } from '@server/places/model/walkingRoute.schema';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import { Callout } from '@shared/ui/Callout';
import { Card } from '@shared/ui/Card';

const CATEGORY_LABELS: Record<Category, string> = {
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

const TAG_LABELS: Record<string, string> = {
	free: 'Бесплатно по данным источника',
	kids: 'Для детей',
	night: 'Ночная активность',
	outdoor_seating: 'Терраса',
	power_sockets: 'Розетки',
	view: 'Вид',
	wheelchair: 'Доступность для коляски',
	wifi: 'Wi-Fi',
};

export interface PlaceCardsProps {
	candidates: readonly Candidate[];
	error: string | null;
	onRetry: () => void;
	onSelect: (id: string) => void;
	pending: boolean;
	selectedId: string | null;
	walkingRoute?: WalkingRoute | null;
}

export function PlaceCards({
	candidates,
	error,
	onRetry,
	onSelect,
	pending,
	selectedId,
	walkingRoute,
}: PlaceCardsProps) {
	return (
		<Card description="Только места, которые вернули инструменты ассистента" title="Места для прогулки">
			{pending ? (
				<div aria-label="Ищем места" className="flex flex-col gap-3" role="status">
					{[0, 1, 2].map((item) => (
						<div className="border-border flex animate-pulse flex-col gap-3 rounded-md border p-4" key={item}>
							<div className="bg-surface-sunken h-5 w-2/3 rounded-sm" />
							<div className="bg-surface-sunken h-4 w-1/3 rounded-sm" />
							<div className="bg-surface-sunken h-12 w-full rounded-sm" />
							<div className="bg-surface-sunken h-4 w-3/4 rounded-sm" />
						</div>
					))}
				</div>
			) : error !== null ? (
				<Callout tone="danger">
					<p>{error}</p>
					<Button className="mt-2" onClick={onRetry} variant="secondary">
						Повторить поиск
					</Button>
				</Callout>
			) : candidates.length === 0 ? (
				<div className="bg-surface-sunken rounded-md p-4">
					<p className="text-fg text-sm font-medium">Пока нет мест для показа</p>
					<p className="text-fg-muted mt-1 text-sm">
						Назовите ориентир и пожелания в чате. Если поиск ничего не нашёл, увеличьте время пешком или измените
						условия.
					</p>
				</div>
			) : (
				<ul className="flex flex-col gap-3">
					{candidates.map((candidate, index) => {
						const { open, place } = candidate;
						const leg =
							walkingRoute?.status === 'available' && walkingRoute.stopIds[index] === place.id
								? walkingRoute.legs[index]
								: null;
						const sourceUrl = /^https:\/\/(?:www\.)?openstreetmap\.org\//u.test(place.sourceUrl)
							? place.sourceUrl
							: null;
						const selected = selectedId === place.id;
						const status =
							open.status === 'open'
								? `Открыто по данным источника${open.until ? ` до ${open.until}` : ''}`
								: open.status === 'closed'
									? `Закрыто${open.opensAt ? `; открытие в ${open.opensAt}` : ''}`
									: 'Часы работы неизвестны — уточните перед выходом';
						return (
							<li
								className={
									selected
										? 'border-accent bg-accent-subtle rounded-md border p-4'
										: 'border-border rounded-md border p-4'
								}
								key={place.id}
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="bg-highlight text-on-highlight flex size-6 items-center justify-center rounded-full text-xs font-semibold">
										{index + 1}
									</span>
									<h3 className="text-fg min-w-0 flex-1 font-semibold">{place.name}</h3>
								</div>
								<p className="text-fg-muted mt-2 text-xs">
									{CATEGORY_LABELS[place.category]}
									{place.address ? ` · ${place.address}` : ''}
								</p>
								<p className="text-fg mt-2 text-sm tabular-nums">
									{Math.round(leg?.distanceM ?? candidate.distanceM)} м · ≈{' '}
									{leg?.walkMinutes ?? candidate.walkMinutes} мин пешком · {candidate.visitMinutes} мин на
									посещение
								</p>
								<p className="text-fg-muted mt-1 text-xs">
									{leg
										? `${index === 0 ? 'От старта' : 'От предыдущей остановки'} по дорожкам. Подход к входу не проверен.`
										: 'Расстояние и время приблизительные, пешеходный путь не проверен.'}
								</p>
								<div className="mt-3">
									<Badge
										className="max-w-full shrink whitespace-normal!"
										tone={
											open.status === 'open' ? 'success' : open.status === 'closed' ? 'neutral' : 'warning'
										}
									>
										{status}
									</Badge>
								</div>
								{open.note && open.note.toLocaleLowerCase('ru') !== status.toLocaleLowerCase('ru') && (
									<p className="text-fg-muted mt-1 text-xs">{open.note}</p>
								)}
								{open.confidence === 'low' && (
									<p className="text-fg-muted mt-1 text-xs">Низкая уверенность в часах работы.</p>
								)}
								{place.description && (
									<p className="text-fg mt-3 text-sm">
										{place.description}{' '}
										<span className="text-fg-muted">
											(
											{place.descriptionSource === 'wikidata'
												? 'Wikidata'
												: place.descriptionSource === 'generated'
													? 'сгенерированная идея'
													: place.descriptionSource === 'osm'
														? 'OpenStreetMap'
														: 'источник описания не указан'}
											)
										</span>
									</p>
								)}
								{candidate.why.tags.length > 0 && (
									<p className="text-fg-muted mt-2 text-xs">
										Совпадения с запросом:{' '}
										{candidate.why.tags.map((tag) => TAG_LABELS[tag] ?? tag).join(', ')}.
									</p>
								)}
								<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
									<Button
										aria-pressed={selected}
										disabled={pending}
										onClick={() => onSelect(place.id)}
										size="lg"
										variant="secondary"
									>
										{selected ? 'Выбрано на карте' : 'Показать на карте'}
									</Button>
									{sourceUrl && (
										<a
											className="text-accent-fg inline-flex min-h-10 items-center text-sm underline underline-offset-4"
											href={sourceUrl}
											rel="noreferrer"
											target="_blank"
										>
											Источник: OpenStreetMap
										</a>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}
