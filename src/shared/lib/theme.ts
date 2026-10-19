export type Theme = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'theme';

/**
 * What a first visit gets. Light, because the product is used outdoors on a phone, and because
 * the map reads better on a light page. Choosing "system" in the toggle still follows the OS.
 */
export const DEFAULT_THEME: Theme = 'light';

/**
 * Runs before first paint in the document head, so an explicitly chosen theme is applied
 * before React hydrates and the page never flashes the wrong palette. It must stay inline
 * and synchronous — a deferred module would run after the first frame.
 *
 * Nothing stored means DEFAULT_THEME. A stored 'system' means no attribute at all, so the
 * `prefers-color-scheme` rule in globals.css decides.
 */
export const THEME_INIT_SCRIPT = `
try {
	var t = localStorage.getItem('${THEME_STORAGE_KEY}');
	if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
	else if (t !== 'system') document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
} catch (e) {
	document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
}
`;
