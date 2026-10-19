import { type ChatMessage } from '@server/agent/model/agent.schema';
import { Avatar } from '@shared/ui/Avatar';
import clsx from 'clsx';

/** The agent is thinking: same bubble geometry as a real reply, so the column does not jump. */
function PendingBubble() {
	return (
		<li className="flex items-end gap-2">
			<Avatar colorKey="agent" name="Agent" size="sm" />

			<div className="bg-surface border-border max-w-[80%] rounded-lg rounded-bl-none border px-3 py-2">
				<div className="flex gap-1" role="status">
					<span className="sr-only">The agent is working</span>
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
}

export function MessageList({ emptyHint, messages, pending }: MessageListProps) {
	if (messages.length === 0 && !pending) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
				<p className="text-fg font-medium">Start the conversation</p>
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
						<Avatar colorKey={mine ? 'you' : 'agent'} name={mine ? 'You' : 'Agent'} size="sm" />

						<div
							className={clsx(
								'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
								mine
									? 'bg-accent text-on-accent rounded-br-none'
									: 'bg-surface text-fg border-border rounded-bl-none border',
							)}
						>
							{message.content}
						</div>
					</li>
				);
			})}

			{pending && <PendingBubble />}
		</ul>
	);
}
