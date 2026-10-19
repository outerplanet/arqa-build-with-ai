'use client';

import { CATEGORY_GROUP_ICON, CATEGORY_GROUP_LABEL, categoryGroup } from '@entities/place/model/category';
import {
	ArrowTopRightOnSquareIcon,
	CheckCircleIcon,
	ClockIcon,
	MapPinIcon,
	QuestionMarkCircleIcon,
	SparklesIcon,
	XCircleIcon,
} from '@heroicons/react/24/outline';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import clsx from 'clsx';
import Image from 'next/image';
import { useId, useState } from 'react';
import { safeHref } from '../model/links';
import { twoGisUrl, yandexMapsUrl } from '../model/mapLinks';
import { CATEGORY_LABELS, commonsImage, formatDistance } from '../model/placeLabels';
import { type PlaceCardModel } from '../model/reply';
import { CATEGORY_MEDIA, CATEGORY_RING, CATEGORY_TEXT } from './categoryClasses';

function sentence(text: string): string {
	return text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
}

function Media({ card }: { card: PlaceCardModel }) {
	const { place } = card.candidate;
	const group = categoryGroup(place.category);
	const Icon = CATEGORY_GROUP_ICON[group];
	const image = commonsImage(place);
	const [failed, setFailed] = useState(false);

	if (image === null || failed) {
		// An icon tile on purpose: tinted by category, a large icon in a disc and the category's name,
		// so a place without a photo does not look like a photo that failed to load.
		return (
			<div
				aria-hidden
				className={clsx(
					'flex h-32 shrink-0 flex-col items-center justify-center gap-2 bg-linear-to-br sm:h-auto sm:min-h-40 sm:w-48',
					CATEGORY_MEDIA[group],
				)}
			>
				<span
					className={clsx(
						'bg-surface/80 flex size-16 items-center justify-center rounded-full ring-2',
						CATEGORY_RING[group],
					)}
				>
					<Icon className="size-9" />
				</span>
				<span className="max-w-full px-2 text-center text-xs font-semibold wrap-anywhere">
					{CATEGORY_GROUP_LABEL[group]}
				</span>
			</div>
		);
	}

	const credit = [image.author, image.license].filter(Boolean).join(', ') || 'автор и лицензия не указаны';
	return (
		<figure className="bg-surface-sunken relative h-44 shrink-0 overflow-hidden sm:h-auto sm:min-h-40 sm:w-48">
			<Image
				alt={`Фото: ${place.name}`}
				className="object-cover"
				fill
				onError={() => setFailed(true)}
				sizes="(min-width: 640px) 192px, 100vw"
				src={image.url}
			/>
			<figcaption className="bg-surface/90 text-fg-muted absolute inset-x-0 bottom-0 truncate px-2 py-1 text-xs">
				<a
					className="hover:text-fg underline-offset-2 hover:underline"
					href={image.pageUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					Фото: {credit} · Wikimedia Commons
				</a>
			</figcaption>
		</figure>
	);
}

function HoursBadge({ card }: { card: PlaceCardModel }) {
	// The tone and the icon follow the tool's `open.status`; the words are the server's sentence.
	if (card.hoursStatus === 'open')
		return (
			<Badge className="max-w-full shrink whitespace-normal" tone="success">
				<CheckCircleIcon aria-hidden className="size-3.5 shrink-0" />
				{sentence(card.hours)}
			</Badge>
		);
	if (card.hoursStatus === 'closed')
		return (
			<Badge className="max-w-full shrink whitespace-normal" tone="neutral">
				<XCircleIcon aria-hidden className="size-3.5 shrink-0" />
				{sentence(card.hours)}
			</Badge>
		);
	return (
		<Badge className="max-w-full shrink whitespace-normal" tone="warning">
			<QuestionMarkCircleIcon aria-hidden className="size-3.5 shrink-0" />
			Часы неизвестны — уточните перед выходом
		</Badge>
	);
}

function OutboundLink({ children, href }: { children: string; href: string }) {
	return (
		<Button asChild className="h-auto min-h-8 whitespace-normal" size="sm" variant="ghost">
			<a href={href} rel="noopener noreferrer" target="_blank">
				{children}
				<ArrowTopRightOnSquareIcon aria-hidden className="size-3.5 shrink-0" />
				<span className="sr-only">(откроется в новой вкладке)</span>
			</a>
		</Button>
	);
}

export interface PlaceCardProps {
	card: PlaceCardModel;
	disabled: boolean;
	onShow: (id: string) => void;
	selected: boolean;
}

export function PlaceCard({ card, disabled, onShow, selected }: PlaceCardProps) {
	const titleId = useId();
	const { place } = card.candidate;
	const group = categoryGroup(place.category);
	const Icon = CATEGORY_GROUP_ICON[group];
	const sourceUrl = safeHref(place.sourceUrl);
	const point = { lat: place.lat, lon: place.lon };

	return (
		<article
			aria-labelledby={titleId}
			className={clsx(
				'bg-surface flex flex-col overflow-hidden rounded-lg border transition-colors sm:flex-row',
				selected ? 'border-accent ring-accent ring-1' : 'border-border',
			)}
		>
			<Media card={card} />

			<div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
				<div className="flex items-start gap-3">
					<span className="bg-highlight text-on-highlight flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
						<span className="sr-only">Место </span>
						{card.order}
					</span>
					<div className="min-w-0">
						<h3 className="text-fg text-md leading-snug font-semibold wrap-anywhere" id={titleId}>
							{place.name}
						</h3>
						<p
							className={clsx(
								'mt-0.5 flex items-start gap-1 text-sm font-medium wrap-anywhere',
								CATEGORY_TEXT[group],
							)}
						>
							<Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
							<span className="min-w-0">{CATEGORY_LABELS[place.category]}</span>
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					<Badge className="text-sm" tone="neutral">
						<MapPinIcon aria-hidden className="size-3.5" />
						<span className="tabular-nums">
							{formatDistance(card.distanceM)} · {card.onFootways ? '' : '≈ '}
							{Math.ceil(card.walkMinutes)} мин пешком
						</span>
					</Badge>
					<Badge className="text-sm" tone="neutral">
						<ClockIcon aria-hidden className="size-3.5" />
						На месте: {card.visitMinutes} мин
					</Badge>
					<HoursBadge card={card} />
				</div>

				<dl className="flex flex-col gap-1.5 text-base">
					{card.why !== null && (
						<div>
							<dt className="text-fg-muted inline font-medium">Почему: </dt>
							<dd className="text-fg inline">{card.why}</dd>
						</div>
					)}
					{card.action !== null && (
						<div>
							<dt className="text-fg-muted inline font-medium">Что делать: </dt>
							<dd className="text-fg inline">
								{card.action}{' '}
								<Badge className="align-middle" tone="info">
									<SparklesIcon aria-hidden className="size-3" />
									идея ИИ
								</Badge>
							</dd>
						</div>
					)}
					{place.description && (
						<div>
							<dt className="sr-only">Описание</dt>
							<dd className="text-fg-muted line-clamp-2 text-sm">
								{place.description} (
								{place.descriptionSource === 'wikidata'
									? 'Wikidata'
									: place.descriptionSource === 'generated'
										? 'сгенерированная идея'
										: place.descriptionSource === 'osm'
											? 'OpenStreetMap'
											: 'источник не указан'}
								)
							</dd>
						</div>
					)}
				</dl>

				{/* How the distance was measured is said once, under the cards (AssistantReply). */}
				{sourceUrl !== null && (
					<p className="text-fg-subtle text-xs">
						<a
							className="text-accent-fg font-medium underline underline-offset-2 hover:no-underline"
							href={sourceUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							Источник: OpenStreetMap
						</a>
					</p>
				)}

				<div className="border-border -mx-1 flex flex-wrap items-center gap-1 border-t pt-3">
					<Button
						aria-pressed={selected}
						className="mr-1"
						disabled={disabled}
						onClick={() => onShow(place.id)}
						size="sm"
						variant={selected ? 'primary' : 'secondary'}
					>
						<MapPinIcon aria-hidden className="size-4" />
						{selected ? 'Выбрано на карте' : 'Показать на карте'}
					</Button>
					<OutboundLink href={twoGisUrl(place.name, point)}>Открыть в 2ГИС</OutboundLink>
					<OutboundLink href={yandexMapsUrl(place.name, point)}>Открыть в Яндекс Картах</OutboundLink>
				</div>
			</div>
		</article>
	);
}
