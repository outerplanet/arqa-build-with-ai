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

/**
 * The card's no-photo tile: a soft category-tinted gradient, so a place without a Commons photo
 * reads as a deliberate icon tile rather than as an image that failed to load.
 */
export const CATEGORY_MEDIA: Record<CategoryGroup, string> = {
	culture: 'from-cat-culture/30 to-cat-culture/5 text-cat-culture',
	food: 'from-cat-food/30 to-cat-food/5 text-cat-food',
	kids: 'from-cat-kids/30 to-cat-kids/5 text-cat-kids',
	nature: 'from-cat-nature/30 to-cat-nature/5 text-cat-nature',
	night: 'from-cat-night/30 to-cat-night/5 text-cat-night',
	other: 'from-cat-other/30 to-cat-other/5 text-cat-other',
	shopping: 'from-cat-shopping/30 to-cat-shopping/5 text-cat-shopping',
	sights: 'from-cat-sights/30 to-cat-sights/5 text-cat-sights',
	sport: 'from-cat-sport/30 to-cat-sport/5 text-cat-sport',
};

export const CATEGORY_RING: Record<CategoryGroup, string> = {
	culture: 'ring-cat-culture/40',
	food: 'ring-cat-food/40',
	kids: 'ring-cat-kids/40',
	nature: 'ring-cat-nature/40',
	night: 'ring-cat-night/40',
	other: 'ring-cat-other/40',
	shopping: 'ring-cat-shopping/40',
	sights: 'ring-cat-sights/40',
	sport: 'ring-cat-sport/40',
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
