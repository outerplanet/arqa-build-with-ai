/**
 * Markdown links in an assistant reply, split out as data so the bubble can render them as real
 * anchors without `dangerouslySetInnerHTML`.
 *
 * Only http(s) links to the two data sources the product cites — OpenStreetMap and Wikidata,
 * including their subdomains — become anchors. Anything else (another host, `javascript:`, a
 * malformed URL) is shown as its label text, so a tool result or a model reply cannot turn the
 * chat into a link to an arbitrary site.
 */
export type TextPart = { href: string; kind: 'link'; text: string } | { kind: 'text'; text: string };

const ALLOWED_HOSTS = ['openstreetmap.org', 'wikidata.org'] as const;

// `[label](url)` — the label has no brackets, the URL no whitespace or closing parenthesis.
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function safeHref(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const host = url.hostname.toLowerCase();
	const allowed = ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));

	return allowed ? url.href : null;
}

export function splitLinks(text: string): TextPart[] {
	const parts: TextPart[] = [];
	let last = 0;

	for (const match of text.matchAll(LINK)) {
		const [whole, label = '', target = ''] = match;
		const start = match.index;
		if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
		const href = safeHref(target);
		parts.push(href === null ? { kind: 'text', text: label } : { href, kind: 'link', text: label });
		last = start + whole.length;
	}
	if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });

	// Neighbouring text parts (a rejected link beside plain text) read as one.
	return parts.reduce<TextPart[]>((merged, part) => {
		const previous = merged.at(-1);
		if (previous?.kind === 'text' && part.kind === 'text') {
			merged[merged.length - 1] = { kind: 'text', text: previous.text + part.text };
		} else {
			merged.push(part);
		}
		return merged;
	}, []);
}
