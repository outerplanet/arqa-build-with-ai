'use client';

import { MapPinIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { type GeoPoint } from '@server/places/model/places.schema';
import { Button } from '@shared/ui/Button';
import { useCallback, useEffect, useRef, useState } from 'react';

export function LocationConsent({
	location,
	onChange,
}: {
	location: GeoPoint | undefined;
	onChange: (point: GeoPoint | undefined) => void;
}) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestGeneration = useRef(0);
	useEffect(
		() => () => {
			requestGeneration.current += 1;
		},
		[],
	);
	const remove = useCallback(() => {
		requestGeneration.current += 1;
		setPending(false);
		setError(null);
		onChange(undefined);
	}, [onChange]);
	const locate = useCallback(() => {
		const generation = ++requestGeneration.current;
		setError(null);
		if (!('geolocation' in navigator)) {
			setError('Браузер не поддерживает геолокацию. Напишите ориентир в сообщении.');
			return;
		}
		setPending(true);
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (generation !== requestGeneration.current) return;
				onChange({
					lat: Math.round(coords.latitude * 1000) / 1000,
					lon: Math.round(coords.longitude * 1000) / 1000,
				});
				setPending(false);
			},
			(cause) => {
				if (generation !== requestGeneration.current) return;
				setError(
					cause.code === 1
						? 'Доступ к геолокации не разрешён. Можно написать ориентир.'
						: 'Не удалось определить точку. Попробуйте ещё раз или напишите ориентир.',
				);
				setPending(false);
			},
			{ enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
		);
	}, [onChange]);
	return (
		<div className="border-border rounded-md border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					className="min-h-10 text-sm whitespace-normal"
					disabled={pending}
					onClick={locate}
					variant="secondary"
				>
					<MapPinIcon aria-hidden className="size-4 shrink-0" />
					{pending ? 'Определяем точку…' : location ? 'Обновить геолокацию' : 'Использовать мою геолокацию'}
				</Button>
				{(location || pending) && (
					<Button
						aria-label="Убрать геолокацию из следующих запросов"
						className="min-h-10"
						onClick={remove}
						variant="ghost"
					>
						<XMarkIcon aria-hidden className="size-4" />
						Убрать
					</Button>
				)}
			</div>
			<p className="text-fg-muted mt-2 text-xs">
				Координаты округляются до ~100 м и нигде не сохраняются.{' '}
				{location
					? 'Точка браузера будет передана со следующим сообщением.'
					: 'Или просто назовите ориентир в Астане.'}
			</p>
			{error && (
				<p className="text-danger mt-2 text-sm" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
