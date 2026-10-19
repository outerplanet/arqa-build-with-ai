import { MapPinIcon } from '@heroicons/react/24/outline';
import { ThemeToggle } from '@shared/ui/ThemeToggle';
import { ToastProvider } from '@shared/ui/Toast';
import { type ComponentType, type ReactNode, type SVGProps } from 'react';
import { NavLink } from './NavLink';

/**
 * A compact header leaves the workspace available to the conversation and map.
 *
 * It takes plain values rather than reaching for the session or the database. A widget may
 * not import from `src/server/`, so whoever renders the shell decides which sections this
 * visitor gets and passes the answer in — filtering by permission, by feature flag, or not
 * at all.
 *
 * The gutter is 24px on a desktop and narrower below. Content stops at 1600px, which is where
 * a table stops being readable rather than where a screen stops being wide.
 */
export interface NavigationSection {
	href: string;
	Icon: ComponentType<SVGProps<SVGSVGElement>>;
	label: string;
}

export interface AppShellProps {
	children: ReactNode;
	sections: readonly NavigationSection[];
	title: string;
}

export function AppShell({ children, sections, title }: AppShellProps) {
	return (
		// The toast provider wraps the shell rather than the page, so a notice survives a
		// navigation: an action on one screen that sends somebody to another still gets to say
		// whether it worked.
		<ToastProvider>
			<div className="flex min-h-screen flex-col">
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="border-border bg-surface flex min-h-18 flex-wrap items-center justify-between gap-3 border-b px-3 py-3 md:px-6">
						<a className="flex min-h-10 items-center gap-2.5" href="/">
							<span className="bg-accent-subtle text-accent-fg flex size-10 items-center justify-center rounded-lg">
								<MapPinIcon aria-hidden className="size-6" />
							</span>
							<span>
								<span className="block text-sm font-semibold sm:text-base">{title}</span>
								<span className="text-fg-muted block text-xs">Места и прогулки рядом с вами</span>
							</span>
						</a>
						<nav aria-label="Разделы" className={sections.length > 1 ? 'flex gap-1 overflow-x-auto' : 'hidden'}>
							{sections.map((section) => (
								<NavLink href={section.href} key={section.href} label={section.label} variant="header">
									<section.Icon aria-hidden className="size-4 shrink-0" />
								</NavLink>
							))}
						</nav>

						<div className="[&_button]:min-h-10 [&_button]:min-w-10">
							<ThemeToggle />
						</div>
					</header>

					<main className="mx-auto w-full max-w-[1600px] flex-1 p-3 md:p-6">{children}</main>
				</div>
			</div>
		</ToastProvider>
	);
}
