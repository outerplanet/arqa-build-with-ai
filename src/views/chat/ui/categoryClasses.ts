import { type CategoryGroup } from '@entities/place/model/category';

/**
 * Category colour classes, written out literally so Tailwind's scanner sees every one of them —
 * a class assembled from `cat-${group}` at runtime would never be generated.
 */
export const CATEGORY_TILE: Record<CategoryGroup, string> = {
	culture: 'bg-cat-culture/15 text-cat-culture',
	food: 'bg-cat-food/15 text-cat-food',
	kids: 'bg-cat-kids/15 text-cat-kids',
	nature: 'bg-cat-nature/15 text-cat-nature',
	night: 'bg-cat-night/15 text-cat-night',
	other: 'bg-cat-other/15 text-cat-other',
	shopping: 'bg-cat-shopping/15 text-cat-shopping',
	sights: 'bg-cat-sights/15 text-cat-sights',
	sport: 'bg-cat-sport/15 text-cat-sport',
};

export const CATEGORY_TEXT: Record<CategoryGroup, string> = {
	culture: 'text-cat-culture',
	food: 'text-cat-food',
	kids: 'text-cat-kids',
	nature: 'text-cat-nature',
	night: 'text-cat-night',
	other: 'text-cat-other',
	shopping: 'text-cat-shopping',
	sights: 'text-cat-sights',
	sport: 'text-cat-sport',
};
