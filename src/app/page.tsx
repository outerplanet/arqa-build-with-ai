import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { ChatScreen } from '@pages/chat';
import { readEnv } from '@server/kernel/env';
import { AppShell, type NavigationSection } from '@widgets/appShell';

// The mode label follows the running server, including after a provider switch.
export const dynamic = 'force-dynamic';

/**
 * Sections are passed in rather than read from anywhere, because a widget may not import from
 * `src/server/`. Whoever renders the shell decides what this visitor sees.
 */
const SECTIONS: readonly NavigationSection[] = [{ href: '/', Icon: ChatBubbleLeftRightIcon, label: 'Ассистент' }];

export default function HomePage() {
	return (
		<AppShell sections={SECTIONS} title="Прогулки по Астане">
			<ChatScreen demoMode={readEnv().LLM_PROVIDER === 'mock'} />
		</AppShell>
	);
}
