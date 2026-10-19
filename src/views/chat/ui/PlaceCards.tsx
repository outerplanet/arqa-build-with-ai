import { type Candidate } from '@server/places/model/places.schema';
import { Badge } from '@shared/ui/Badge';
import { Button } from '@shared/ui/Button';
import clsx from 'clsx';

export function PlaceCards({
	candidates,
	onSelect,
	selectedId,
}: {
	candidates: readonly Candidate[];
	onSelect: (id: string) => void;
	selectedId: string | null;
}) {
	return (
		<ol className="grid gap-3">
			{candidates.map((candidate, index) => {
				const { open, place } = candidate;
				const selected = selectedId === place.id;
				const source =
					place.descriptionSource === 'wikidata'
						? 'Wikidata'
						: place.descriptionSource === 'generated'
							? 'Сгенерированное описание'
							: 'OpenStreetMap';
				const sourceUrl = /^https:\/\/(?:www\.)?openstreetmap\.org\//u.test(place.sourceUrl)
					? place.sourceUrl
					: null;
				return (
					<li
						className={clsx(
							'border-border bg-surface rounded-lg border p-4',
							selected && 'border-accent ring-accent ring-1',
						)}
						key={place.id}
					>
						<div className="flex items-start gap-3">
							<span className="bg-accent-subtle text-accent-fg flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
								{index + 1}
							</span>
							<div className="min-w-0 flex-1">
								<h3 className="font-semibold">{place.name}</h3>
								<p className="text-fg-muted mt-1 text-sm">
									{Math.round(candidate.distanceM)} м · {Math.ceil(candidate.walkMinutes)} мин пешком ·{' '}
									{candidate.visitMinutes} мин на месте
								</p>
							</div>
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							<Badge tone={open.status === 'open' ? 'success' : open.status === 'closed' ? 'danger' : 'warning'}>
								{open.status === 'open'
									? 'Открыто по данным OSM'
									: open.status === 'closed'
										? 'Закрыто по данным OSM'
										: 'Часы работы неизвестны'}
							</Badge>
							<Badge>{source}</Badge>
						</div>
						<p className="text-fg-muted mt-2 text-xs">
							{open.status === 'unknown' ? 'Уточните часы перед выходом.' : open.note}
							{open.confidence === 'low' ? ' Низкая уверенность в расписании.' : ''}
						</p>
						{place.description && <p className="mt-3 text-sm">{place.description}</p>}
						{candidate.why.tags.length > 0 && (
							<p className="text-fg-muted mt-2 text-xs">Совпало с запросом: {candidate.why.tags.join(', ')}</p>
						)}
						<div className="mt-3 flex flex-wrap items-center gap-3">
							<Button
								aria-pressed={selected}
								className="min-h-10 text-sm"
								onClick={() => onSelect(place.id)}
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
									Объект в OpenStreetMap ↗
								</a>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
