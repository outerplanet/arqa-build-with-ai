import {
	BuildingLibraryIcon,
	BuildingStorefrontIcon,
	CakeIcon,
	FaceSmileIcon,
	MapPinIcon,
	MoonIcon,
	SparklesIcon,
	SunIcon,
	TrophyIcon,
} from '@heroicons/react/24/solid';
import { type Category } from '@server/places/model/places.schema';
import { type ComponentType, type SVGProps } from 'react';

/**
 * Visual grouping of the fixed category list, shared by the chat cards and the map so a place has
 * one colour and one icon everywhere. Colours are semantic tokens `--color-cat-<group>` defined in
 * `src/app/globals.css`; never hard-code a colour next to this map.
 */
export const CATEGORY_GROUPS = [
	'food',
	'culture',
	'sights',
	'nature',
	'kids',
	'night',
	'shopping',
	'sport',
	'other',
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

const GROUP_OF: Record<Category, CategoryGroup> = {
	artwork: 'sights',
	attraction: 'sights',
	bar: 'night',
	cafe: 'food',
	cinema: 'culture',
	fast_food: 'food',
	gallery: 'culture',
	garden: 'nature',
	library: 'culture',
	mall: 'shopping',
	monument: 'sights',
	museum: 'culture',
	nightclub: 'night',
	other: 'other',
	park: 'nature',
	place_of_worship: 'sights',
	playground: 'kids',
	restaurant: 'food',
	sports: 'sport',
	theatre: 'culture',
	theme_park: 'kids',
	viewpoint: 'sights',
	zoo: 'kids',
};

export const CATEGORY_GROUP_LABEL: Record<CategoryGroup, string> = {
	culture: 'Культура',
	food: 'Еда и кофе',
	kids: 'Для детей',
	nature: 'Парки',
	night: 'Вечер и ночь',
	other: 'Другое',
	shopping: 'Торговые центры',
	sights: 'Достопримечательности',
	sport: 'Спорт',
};

export const CATEGORY_GROUP_ICON: Record<CategoryGroup, ComponentType<SVGProps<SVGSVGElement>>> = {
	culture: BuildingLibraryIcon,
	food: CakeIcon,
	kids: FaceSmileIcon,
	nature: SunIcon,
	night: MoonIcon,
	other: MapPinIcon,
	shopping: BuildingStorefrontIcon,
	sights: SparklesIcon,
	sport: TrophyIcon,
};

export function categoryGroup(category: Category): CategoryGroup {
	return GROUP_OF[category];
}

/** The CSS custom property holding the group's colour, for MapLibre paint and inline SVG fills. */
export function categoryColorVar(group: CategoryGroup): `--color-cat-${CategoryGroup}` {
	return `--color-cat-${group}`;
}
