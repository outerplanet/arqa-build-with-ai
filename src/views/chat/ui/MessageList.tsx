'use client';

import { type ChatMessage } from '@server/agent/model/agent.schema';
import { parseInlineMarkdown } from '@shared/lib';
import { Avatar } from '@shared/ui/Avatar';
import clsx from 'clsx';
import { Fragment, useEffect, useRef } from 'react';

/** The agent is thinking: same bubble geometry as a real reply, so the column does not jump. */
function PendingBubble() {
	return (
		<li className="flex items-end gap-2">
			<Avatar colorKey="agent" name="Ассистент" size="sm" />

			<div className="bg-surface border-border max-w-[80%] rounded-lg rounded-bl-none border px-3 py-2">
				<div className="flex gap-1" role="status">
					<span className="sr-only">Ассистент работает</span>
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full" />
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
				</div>
			</div>
		</li>
	);
}

/**
 * An assistant reply with its light Markdown applied. Only the assistant's text goes through
 * this: what the user typed is shown exactly as typed. Lines are rejoined with a newline and the
 * bubble keeps `whitespace-pre-wrap`, so the paragraph breaks the model wrote survive.
 */
function AssistantText({ content }: { content: string }) {
	return parseInlineMarkdown(content).map((line, lineIndex) => {
		const segments = line.segments.map((segment, segmentIndex) =>
			segment.bold ? (
				<strong className="font-semibold" key={`s-${String(segmentIndex)}`}>
					{segment.text}
				</strong>
			) : (
				<Fragment key={`s-${String(segmentIndex)}`}>{segment.text}</Fragment>
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

export interface MessageListProps {
	emptyHint: string;
	messages: readonly ChatMessage[];
	pending: boolean;
}

export function MessageList({ emptyHint, messages, pending }: MessageListProps) {
	const endRef = useRef<HTMLLIElement>(null);

	// Follow the conversation: a new message or the thinking bubble brings the end into view.
	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}, [messages, pending]);

	if (messages.length === 0 && !pending) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
				<p className="text-fg font-medium">Начните разговор</p>
				<p className="text-fg-muted text-sm">{emptyHint}</p>
			</div>
		);
	}

	return (
		<ul className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
			{messages.map((message, index) => {
				const mine = message.role === 'user';

				return (
					<li
						className={clsx('flex items-end gap-2', mine && 'flex-row-reverse')}
						key={`${message.role}-${String(index)}`}
					>
						<Avatar colorKey={mine ? 'you' : 'agent'} name={mine ? 'Вы' : 'Ассистент'} size="sm" />

						<div
							className={clsx(
								'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
								mine
									? 'bg-accent text-on-accent rounded-br-none'
									: 'bg-surface text-fg border-border rounded-bl-none border',
							)}
						>
							{mine ? message.content : <AssistantText content={message.content} />}
						</div>
					</li>
				);
			})}

			{pending && <PendingBubble />}

			<li aria-hidden ref={endRef} />
		</ul>
	);
}
