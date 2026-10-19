import { ChatScreen } from '@pages/chat';
import { ThemeToggle } from '@shared/ui/ThemeToggle';
import { ToastProvider } from '@shared/ui/Toast';

export default function HomePage() {
	return (
		<ToastProvider>
			<div className="bg-canvas text-fg min-h-screen">
				<header className="border-border bg-surface border-b">
					<div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-4 px-3 md:px-6">
						<p className="text-fg font-semibold">
							Прогулки по Астане{' '}
							<span className="text-fg-muted hidden text-xs font-normal sm:inline">
								· Город ближе, чем кажется
							</span>
						</p>
						<ThemeToggle />
					</div>
				</header>
				<main className="mx-auto max-w-[1600px] p-3 md:p-6">
					<ChatScreen />
				</main>
				<footer className="text-fg-muted mx-auto max-w-[1600px] px-3 pb-6 text-xs md:px-6">
					© участники OpenStreetMap · Wikidata · Расстояния приблизительные. Проверяйте часы работы перед выходом.
				</footer>
			</div>
		</ToastProvider>
	);
}
