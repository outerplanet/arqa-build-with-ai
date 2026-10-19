'use client';

import { Button } from '@shared/ui/Button';
import { Callout } from '@shared/ui/Callout';
import { Card } from '@shared/ui/Card';
import { useChat } from '../model/useChat';
import { AgentActivity } from './AgentActivity';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

/**
 * A conversation on the left, the agent's actual work on the right.
 *
 * Two columns on a desktop, stacked on a phone. The activity panel is not decoration — it is the
 * argument that this is an agent rather than a chatbot, so it gets equal billing rather than a
 * collapsible drawer nobody opens during a ninety-second demo.
 *
 * The copy is props with defaults, because it is the first thing anyone changes.
 */
export interface ChatScreenProps {
	emptyHint?: string;
	placeholder?: string;
	subtitle?: string;
	title?: string;
}

export function ChatScreen({
	emptyHint = 'Try: “What time is it?”',
	placeholder = 'Ask something…',
	subtitle = 'Ask in plain language. The agent decides which tools it needs and shows its work.',
	title = 'Agent',
}: ChatScreenProps) {
	const { error, messages, retry, send, status, toolCalls } = useChat();
	const pending = status === 'sending';

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-lg font-semibold">{title}</h1>
				<p className="text-fg-muted text-sm">{subtitle}</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<Card className="min-h-[32rem]" description="Conversation" title="Chat">
					<div className="flex min-h-0 flex-1 flex-col">
						<MessageList emptyHint={emptyHint} messages={messages} pending={pending} />

						{error !== null && (
							<Callout tone="danger">
								<div className="flex flex-wrap items-center gap-2">
									<span>{error}</span>
									<Button onClick={retry} size="sm" variant="secondary">
										Retry
									</Button>
								</div>
							</Callout>
						)}

						<Composer disabled={pending} onSend={send} placeholder={placeholder} />
					</div>
				</Card>

				<AgentActivity pending={pending} toolCalls={toolCalls} />
			</div>
		</div>
	);
}
