'use client';

import { CATEGORY_GROUP_ICON, categoryGroup } from '@entities/place/model/category';
import clsx from 'clsx';
import { CATEGORY_LABELS, formatDistance } from '../model/placeLabels';
import { type PlaceCardModel } from '../model/reply';
import { CATEGORY_TEXT } from './categoryClasses';

export interface PlaceListProps {
	cards: readonly PlaceCardModel[];
	error: string | null;
	onSelect: (id: string) => void;
	pending: boolean;
	selectedId: string | null;
}

/**
 * The map's legend: one line per marker, in the same order and numbering, synced with the
 * selection both ways. The details live in the chat cards — this list never repeats them.
 */
export function PlaceList({ cards, error, onSelect, pending, selectedId }: PlaceListProps) {
	if (pending)
		return (
			<ul aria-label="Ищем места" className="flex flex-col gap-1.5" role="status">
				{[0, 1, 2].map((item) => (
					<li
						className="border-border flex h-14 animate-pulse items-center gap-3 rounded-md border px-3"
						key={item}
					>
						<div className="bg-surface-sunken size-6 shrink-0 rounded-full" />
						<div className="flex-1">
							<div className="bg-surface-sunken h-3.5 w-1/2 rounded-sm" />
							<div className="bg-surface-sunken mt-1.5 h-3 w-1/3 rounded-sm" />
						</div>
					</li>
				))}
			</ul>
		);

	if (error !== null) return <p className="text-fg-muted text-sm">Места не загрузились — повторите запрос в чате.</p>;

	if (cards.length === 0)
		return <p className="text-fg-muted text-sm">Здесь появится список мест на карте — после ответа ассистента.</p>;

	return (
		<ol aria-label="Места на карте" className="flex flex-col gap-1.5">
			{cards.map((card) => {
				const { place } = card.candidate;
				const group = categoryGroup(place.category);
				const Icon = CATEGORY_GROUP_ICON[group];
				const selected = selectedId === place.id;
				return (
					<li key={place.id}>
						<button
							aria-pressed={selected}
							className={clsx(
								'flex min-h-14 w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
								selected ? 'border-accent bg-accent-subtle' : 'border-border bg-surface hover:bg-surface-hover',
							)}
							onClick={() => onSelect(place.id)}
							type="button"
						>
							<span className="bg-highlight text-on-highlight flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
								{card.order}
							</span>
							<span className="min-w-0 flex-1">
								<span className="text-fg block truncate text-base font-medium">{place.name}</span>
								<span className="text-fg-muted flex items-center gap-1 text-xs">
									<Icon aria-hidden className={clsx('size-3.5 shrink-0', CATEGORY_TEXT[group])} />
									{CATEGORY_LABELS[place.category]} · {formatDistance(card.distanceM)} ·{' '}
									{Math.ceil(card.walkMinutes)} мин пешком
								</span>
							</span>
							{selected && <span className="text-accent-fg shrink-0 text-xs font-medium">на карте</span>}
						</button>
					</li>
				);
			})}
		</ol>
	);
}
