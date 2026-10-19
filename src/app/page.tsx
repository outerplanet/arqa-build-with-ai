import { ChatBubbleLeftRightIcon, SwatchIcon } from '@heroicons/react/24/outline';
import { ChatScreen } from '@pages/chat';
import { AppShell, type NavigationSection } from '@widgets/appShell';

/**
 * The one screen the starter ships with. Replace the copy, then the tools, then this page.
 *
 * Sections are passed in rather than read from anywhere, because a widget may not import from
 * `src/server/`. Whoever renders the shell decides what this visitor sees.
 */
const SECTIONS: readonly NavigationSection[] = [
	{ href: '/', Icon: ChatBubbleLeftRightIcon, label: 'Agent' },
	{ href: '/design', Icon: SwatchIcon, label: 'Design system' },
];

export default function HomePage() {
	return (
		<AppShell sections={SECTIONS} title="Starter">
			<ChatScreen />
		</AppShell>
	);
}
