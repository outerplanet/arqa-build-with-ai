'use client';

import { type ChatMessage } from '@server/agent/model/agent.schema';
import { Avatar } from '@shared/ui/Avatar';
import clsx from 'clsx';
import { type ReactNode, useEffect, useRef } from 'react';
import { AssistantText } from './AssistantText';

/** The agent is thinking: same bubble geometry as a real reply, so the column does not jump. */
function PendingBubble() {
	return (
		<li className="flex items-end gap-2">
			<Avatar colorKey="agent" name="Ассистент" size="sm" />

			<div className="bg-surface border-border max-w-[80%] rounded-lg rounded-bl-none border px-3 py-2">
				<div className="flex items-center gap-2" role="status">
					<span className="text-fg-muted text-sm">Ищу места и проверяю часы работы</span>
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full" />
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
					<span className="bg-fg-subtle size-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
				</div>
			</div>
		</li>
	);
}

export interface MessageListProps {
	emptyHint: string;
	messages: readonly ChatMessage[];
	pending: boolean;
	/** The structured rendering of the reply at `replyIndex`; null keeps the plain bubble. */
	reply: ReactNode;
	replyIndex: number;
}

export function MessageList({ emptyHint, messages, pending, reply, replyIndex }: MessageListProps) {
	const endRef = useRef<HTMLLIElement>(null);

	// Follow the conversation: a new message or the thinking bubble brings the end into view.
	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}, [messages, pending]);

	if (messages.length === 0 && !pending) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-8 text-center">
				<p className="text-fg font-medium">Начните разговор</p>
				<p className="text-fg-muted text-sm">{emptyHint}</p>
			</div>
		);
	}

	return (
		<ul className="flex flex-1 flex-col gap-4 py-2">
			{messages.map((message, index) => {
				const mine = message.role === 'user';
				const rich = !mine && index === replyIndex && reply !== null;

				return (
					<li
						className={clsx('flex items-start gap-2', mine && 'flex-row-reverse')}
						key={`${message.role}-${String(index)}`}
					>
						{/* A phone needs the avatar's width for the place cards more than it needs the avatar. */}
						<span className={clsx('shrink-0', rich && 'hidden sm:block')}>
							<Avatar colorKey={mine ? 'you' : 'agent'} name={mine ? 'Вы' : 'Ассистент'} size="sm" />
						</span>

						{rich ? (
							<div className="min-w-0 flex-1">{reply}</div>
						) : (
							<div
								className={clsx(
									'max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-base wrap-anywhere whitespace-pre-wrap',
									mine
										? 'bg-accent text-on-accent rounded-tr-none'
										: 'bg-surface text-fg border-border rounded-tl-none border',
								)}
							>
								{mine ? message.content : <AssistantText content={message.content} />}
							</div>
						)}
					</li>
				);
			})}

			{pending && <PendingBubble />}

			<li aria-hidden ref={endRef} />
		</ul>
	);
}
