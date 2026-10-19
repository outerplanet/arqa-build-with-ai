import clsx, { type ClassValue } from 'clsx';

/**
 * `clsx`, plus "the caller's class wins".
 *
 * A component's own classes and a caller's override land in one `class` attribute, and Tailwind
 * decides between `whitespace-nowrap` and `whitespace-normal` by stylesheet order, not by the order
 * in the attribute. So `<Button className="h-auto whitespace-normal">` silently kept the button's
 * `h-9 whitespace-nowrap`, and call sites reached for `!important`.
 *
 * This is a deliberately small merger, not tailwind-merge: it knows the handful of utility groups
 * the shared components set and a caller plausibly overrides. A later class drops an earlier one of
 * the same group under the same variants (`hover:`, `sm:` …); everything it does not recognise is
 * kept as written. Add a group here when a component starts setting a new one.
 */
const GROUPS: readonly (readonly [string, RegExp])[] = [
	['whitespace', /^whitespace-/u],
	['h', /^h-/u],
	['min-h', /^min-h-/u],
	['max-h', /^max-h-/u],
	['w', /^w-/u],
	['min-w', /^min-w-/u],
	['max-w', /^max-w-/u],
	['px', /^px-/u],
	['py', /^py-/u],
	['text-size', /^text-(?:xs|sm|base|md|lg|xl|[2-9]xl)$/u],
	['font-weight', /^font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)$/u],
	['rounded', /^rounded(?:-(?:none|sm|md|lg|xl|2xl|full))?$/u],
	['justify', /^justify-(?:start|end|center|between|around|evenly|stretch|normal)$/u],
	['items', /^items-/u],
	['gap', /^gap-\d/u],
	['shrink', /^shrink(?:-|$)/u],
	['display', /^(?:inline-flex|flex|block|inline-block|inline|grid|hidden)$/u],
];

function groupOf(token: string): string | null {
	const cut = token.lastIndexOf(':');
	const variants = cut === -1 ? '' : token.slice(0, cut + 1);
	const utility = token.slice(cut + 1).replace(/^!|!$/gu, '');
	const group = GROUPS.find(([, pattern]) => pattern.test(utility));
	return group ? `${variants}${group[0]}` : null;
}

export function cn(...inputs: ClassValue[]): string {
	const tokens = clsx(inputs).split(/\s+/u).filter(Boolean);
	const seen = new Set<string>();
	const kept: string[] = [];
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const token = tokens[index]!;
		const key = groupOf(token) ?? `=${token}`;
		if (!seen.has(key)) {
			seen.add(key);
			kept.push(token);
		}
	}
	return kept.reverse().join(' ');
}
