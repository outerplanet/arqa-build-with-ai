'use client';

import { type GeoPoint } from '@server/places/model/places.schema';
import { Button } from '@shared/ui/Button';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LocationControlProps {
	disabled?: boolean;
	location: GeoPoint | null;
	onChange: (location: GeoPoint | null) => void;
}

export function LocationControl({ disabled = false, location, onChange }: LocationControlProps) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestGeneration = useRef(0);
	useEffect(
		() => () => {
			requestGeneration.current += 1;
		},
		[],
	);

	const locate = useCallback(() => {
		const generation = ++requestGeneration.current;
		setError(null);
		const { geolocation } = navigator as { geolocation?: Geolocation };
		if (geolocation === undefined) {
			setError('Браузер не поддерживает геолокацию. Напишите ориентир в сообщении.');
			return;
		}
		setPending(true);
		geolocation.getCurrentPosition(
			(position) => {
				if (generation !== requestGeneration.current) return;
				onChange({
					lat: Math.round(position.coords.latitude * 1000) / 1000,
					lon: Math.round(position.coords.longitude * 1000) / 1000,
				});
				setPending(false);
			},
			(failure) => {
				if (generation !== requestGeneration.current) return;
				setPending(false);
				setError(
					failure.code === 1
						? 'Доступ к геолокации запрещён. Разрешите его в браузере или напишите ориентир.'
						: failure.code === 3
							? 'Не удалось получить координаты вовремя. Повторите попытку или напишите ориентир.'
							: 'Не удалось определить местоположение. Повторите попытку или напишите ориентир.',
				);
			},
			{ enableHighAccuracy: false, maximumAge: 0, timeout: 10000 },
		);
	}, [onChange]);

	const clearLocation = useCallback(() => {
		requestGeneration.current += 1;
		setPending(false);
		setError(null);
		onChange(null);
	}, [onChange]);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					className="h-auto min-h-10 whitespace-normal"
					disabled={disabled || pending}
					onClick={locate}
					variant="secondary"
				>
					{pending ? 'Определяем местоположение…' : 'Использовать мою геолокацию'}
				</Button>
				{(location !== null || pending) && (
					<Button onClick={clearLocation} size="lg" variant="ghost">
						Убрать геолокацию
					</Button>
				)}
			</div>
			<p className="text-fg-muted text-xs">
				Координаты округляются до ~100 м. Приложение не записывает их в хранилище или логи; в живом режиме они
				передаются провайдеру модели. Можно просто назвать ориентир в чате.
			</p>
			{location !== null && (
				<p className="text-fg-muted text-xs" role="status">
					Точка браузера: {location.lat.toFixed(3)}, {location.lon.toFixed(3)}. Используем в следующем сообщении.
				</p>
			)}
			{error !== null && (
				<p className="text-danger text-sm" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
