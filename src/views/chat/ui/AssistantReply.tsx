'use client';

import {
	AdjustmentsHorizontalIcon,
	ChevronRightIcon,
	InformationCircleIcon,
	MapPinIcon,
} from '@heroicons/react/24/outline';
import { Badge } from '@shared/ui/Badge';
import { type PlaceCardModel, type ReplySummary } from '../model/reply';
import { AssistantText } from './AssistantText';
import { PlaceCard } from './PlaceCard';

export interface AssistantReplyProps {
	cards: readonly PlaceCardModel[];
	disabled: boolean;
	locationLabel: string | null;
	onShow: (id: string) => void;
	reply: string;
	selectedId: string | null;
	summary: ReplySummary;
}

/**
 * One assistant turn as a guide app shows it: a headline, where the location came from and which
 * filters ran, the server's caveats, then a card per place. The reply text the server wrote — the
 * case's answer format, word for word — stays one click away under «Полный ответ».
 */
export function AssistantReply({
	cards,
	disabled,
	locationLabel,
	onShow,
	reply,
	selectedId,
	summary,
}: AssistantReplyProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="bg-surface border-border flex flex-col gap-2 rounded-lg rounded-tl-none border px-4 py-3">
				<p className="text-fg text-md font-semibold">{summary.headline}</p>
				{(summary.source !== null || summary.filters.length > 0) && (
					<ul aria-label="Что учтено" className="flex flex-wrap gap-1.5">
						{summary.source !== null && (
							<li>
								<Badge className="max-w-full shrink whitespace-normal" tone="accent">
									<MapPinIcon aria-hidden className="size-3.5 shrink-0" />
									Точка: {locationLabel ?? 'ваши координаты'} — {summary.source}
								</Badge>
							</li>
						)}
						{summary.filters.map((filter) => (
							<li key={filter}>
								<Badge className="max-w-full shrink whitespace-normal" tone="neutral">
									<AdjustmentsHorizontalIcon aria-hidden className="size-3.5 shrink-0" />
									{filter}
								</Badge>
							</li>
						))}
					</ul>
				)}
				{summary.notes.map((note) => (
					<p className="text-fg-muted flex items-start gap-1.5 text-sm" key={note}>
						<InformationCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
						<span>{note}</span>
					</p>
				))}
			</div>

			{cards.length > 0 && (
				<ol aria-label="Рекомендованные места" className="flex flex-col gap-3">
					{cards.map((card) => (
						<li key={card.candidate.place.id}>
							<PlaceCard
								card={card}
								disabled={disabled}
								onShow={onShow}
								selected={selectedId === card.candidate.place.id}
							/>
						</li>
					))}
				</ol>
			)}

			<details className="group">
				<summary className="text-fg-muted hover:text-fg inline-flex min-h-8 items-center gap-1 text-sm font-medium">
					<ChevronRightIcon aria-hidden className="size-4 transition-transform group-open:rotate-90" />
					Полный ответ — текст ассистента целиком
				</summary>
				<div className="bg-surface-sunken text-fg mt-1 rounded-md px-3 py-2 text-sm wrap-anywhere whitespace-pre-wrap">
					<AssistantText content={reply} />
				</div>
			</details>
		</div>
	);
}
