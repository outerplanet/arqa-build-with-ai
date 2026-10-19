import { MapPinIcon } from '@heroicons/react/24/outline';
import { ChatScreen } from '@pages/chat';
import { readEnv } from '@server/kernel/env';
import { ThemeToggle } from '@shared/ui/ThemeToggle';
import { ToastProvider } from '@shared/ui/Toast';

// Resolve the running provider at request time, including after a provider switch.
export const dynamic = 'force-dynamic';

export default function HomePage() {
	return (
		<ToastProvider>
			<div className="bg-canvas text-fg min-h-screen">
				<header className="border-border bg-surface border-b">
					<div className="mx-auto flex min-h-14 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-6">
						<p className="text-fg flex items-center gap-2 font-semibold">
							<MapPinIcon aria-hidden className="text-accent-fg size-5" />
							Прогулки по Астане
							<span className="text-fg-muted hidden text-xs font-normal sm:inline">
								· Город ближе, чем кажется
							</span>
						</p>
						<ThemeToggle />
					</div>
				</header>
				<main className="mx-auto max-w-[1600px] px-4 py-4 md:p-6">
					<ChatScreen demoMode={readEnv().LLM_PROVIDER === 'mock'} />
				</main>
				<footer className="border-border text-fg-muted mx-auto flex max-w-[1600px] flex-col gap-1 border-t px-4 py-5 text-xs md:px-6">
					<p>
						Данные: ©{' '}
						<a
							className="hover:text-fg underline underline-offset-2"
							href="https://www.openstreetmap.org/copyright"
							rel="noopener noreferrer"
							target="_blank"
						>
							участники OpenStreetMap
						</a>
						, Wikidata; фото — Wikimedia Commons. Снимок данных: 19.10.2026.
					</p>
					<p>Расстояния и время приблизительные. Проверяйте часы работы перед выходом.</p>
				</footer>
			</div>
		</ToastProvider>
	);
}
