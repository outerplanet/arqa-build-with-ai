/**
 * The case's scenarios (docs/case.md), word for word in substance. The chip shows exactly what it
 * sends. The first two name a landmark; the rest search «рядом» and need the browser location,
 * or the agent asks where the user is — the chip marks them with a pin and the hint above the
 * group says to press the geolocation button first.
 *
 * The mock adapter classifies these texts by keyword (src/server/agent/usecase/scenario.ts), so
 * keep the keywords when editing.
 */
import { type CategoryGroup } from '@entities/place/model/category';

export interface Scenario {
	/** Picks the card's icon and colour from the place category groups; decoration only. */
	group: CategoryGroup;
	needsLocation: boolean;
	query: string;
	/** A short heading above the query; the query itself is still shown in full. */
	title: string;
}

export const SCENARIOS: readonly Scenario[] = [
	{
		group: 'sights',
		needsLocation: false,
		query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
		title: 'Необычное у Экспо',
	},
	{
		group: 'nature',
		needsLocation: false,
		query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.',
		title: 'Прогулка от Mega',
	},
	{
		group: 'food',
		needsLocation: true,
		query: 'Хочу тихое место с кофе и розеткой недалеко от меня.',
		title: 'Кофе и розетка',
	},
	{
		group: 'kids',
		needsLocation: true,
		query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
		title: 'С ребёнком',
	},
	{
		group: 'culture',
		needsLocation: true,
		query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
		title: '2 часа до вылета',
	},
	{
		group: 'night',
		needsLocation: true,
		query: 'Ищу необычную ночную активность на последние пару часов.',
		title: 'Ночью',
	},
];
