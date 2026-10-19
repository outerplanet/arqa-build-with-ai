/**
 * The case's scenarios (docs/case.md), word for word in substance. The chip shows exactly what it
 * sends. The first two name a landmark; the rest search «рядом» and need the browser location,
 * or the agent asks where the user is — the chip marks them with a pin and the hint above the
 * group says to press the geolocation button first.
 *
 * The mock adapter classifies these texts by keyword (src/server/agent/usecase/scenario.ts), so
 * keep the keywords when editing.
 */
export interface Scenario {
	needsLocation: boolean;
	query: string;
}

export const SCENARIOS: readonly Scenario[] = [
	{ needsLocation: false, query: 'Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.' },
	{ needsLocation: false, query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут.' },
	{ needsLocation: true, query: 'Хочу тихое место с кофе и розеткой недалеко от меня.' },
	{ needsLocation: true, query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?' },
	{ needsLocation: true, query: 'Я — турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?' },
	{ needsLocation: true, query: 'Ищу необычную ночную активность на последние пару часов.' },
];
