/**
 * Just enough Markdown to make an assistant's reply read cleanly, and nothing that can inject.
 *
 * Models answer in Markdown whether or not they are asked to. Shown raw, a reply is littered with
 * `**` and `###`; rendered through a full Markdown library with `dangerouslySetInnerHTML`, it is
 * an injection surface for whatever text a tool returned. This does three things only:
 *
 * - `**bold**` becomes a bold segment;
 * - a line starting with `#`, `##` or `###` becomes a bold line, without the hashes;
 * - single backticks around inline code are removed.
 *
 * It returns plain data. The caller maps segments to React elements, so every character still
 * goes through React's escaping.
 */
export interface InlineSegment {
	bold: boolean;
	text: string;
}

export interface MarkdownLine {
	heading: boolean;
	segments: InlineSegment[];
}

const HEADING = /^#{1,3}\s+/;
const INLINE_CODE = /`([^`\n]+)`/g;
const BOLD = /\*\*(.+?)\*\*/;

function segmentsOf(text: string): InlineSegment[] {
	// A capturing group keeps the bold parts in the split: even indexes are plain, odd are bold.
	return text
		.split(BOLD)
		.map((part, index) => ({ bold: index % 2 === 1, text: part }))
		.filter((segment) => segment.text.length > 0);
}

export function parseInlineMarkdown(source: string): MarkdownLine[] {
	return source.split('\n').map((raw) => {
		const heading = HEADING.test(raw);
		const text = (heading ? raw.replace(HEADING, '') : raw).replace(INLINE_CODE, '$1');

		return { heading, segments: segmentsOf(text) };
	});
}
