import { parseInlineMarkdown } from '@shared/lib';
import { Fragment } from 'react';
import { splitLinks } from '../model/links';

/** Plain text with its allow-listed Markdown links turned into real anchors. */
function LinkedText({ text }: { text: string }) {
	return splitLinks(text).map((part, index) =>
		part.kind === 'link' ? (
			<a
				className="text-accent-fg underline underline-offset-2 hover:no-underline"
				href={part.href}
				key={`p-${String(index)}`}
				rel="noopener noreferrer"
				target="_blank"
			>
				{part.text}
			</a>
		) : (
			<Fragment key={`p-${String(index)}`}>{part.text}</Fragment>
		),
	);
}

/**
 * An assistant reply with its light Markdown applied. Only the assistant's text goes through
 * this: what the user typed is shown exactly as typed. Lines are rejoined with a newline and the
 * container keeps `whitespace-pre-wrap`, so the paragraph breaks the model wrote survive.
 */
export function AssistantText({ content }: { content: string }) {
	return parseInlineMarkdown(content).map((line, lineIndex) => {
		const segments = line.segments.map((segment, segmentIndex) =>
			segment.bold ? (
				<strong className="font-semibold" key={`s-${String(segmentIndex)}`}>
					<LinkedText text={segment.text} />
				</strong>
			) : (
				<LinkedText key={`s-${String(segmentIndex)}`} text={segment.text} />
			),
		);

		return (
			<Fragment key={`l-${String(lineIndex)}`}>
				{lineIndex > 0 && '\n'}
				{line.heading ? <strong className="font-semibold">{segments}</strong> : segments}
			</Fragment>
		);
	});
}
