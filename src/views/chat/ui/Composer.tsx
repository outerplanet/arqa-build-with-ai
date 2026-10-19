'use client';

import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { Button } from '@shared/ui/Button';
import { Textarea } from '@shared/ui/Textarea';
import { type FormEvent, type KeyboardEvent, useState } from 'react';

/**
 * A draft, and a button that sends it. Nothing writes on `change`.
 *
 * Enter sends and Shift+Enter breaks the line, because on stage the demo is typed, not clicked.
 */
export interface ComposerProps {
	disabled: boolean;
	onSend: (content: string) => void;
	placeholder: string;
}

export function Composer({ disabled, onSend, placeholder }: ComposerProps) {
	const [draft, setDraft] = useState('');
	const empty = draft.trim().length === 0;

	function submit(event?: FormEvent) {
		event?.preventDefault();
		if (empty || disabled) return;

		onSend(draft.trim());
		setDraft('');
	}

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<form className="border-border flex items-end gap-2 border-t pt-3" onSubmit={submit}>
			<Textarea
				aria-label="Message"
				className="min-h-[2.75rem] flex-1 resize-none"
				disabled={disabled}
				onChange={(event) => {
					setDraft(event.target.value);
				}}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				rows={2}
				value={draft}
			/>

			<Button aria-label="Send" disabled={disabled || empty} type="submit">
				<PaperAirplaneIcon aria-hidden className="size-4" />
				Send
			</Button>
		</form>
	);
}
