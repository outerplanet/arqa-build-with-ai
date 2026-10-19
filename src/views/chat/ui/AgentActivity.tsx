import { CheckCircleIcon, CpuChipIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { type ToolCall } from '@server/agent/model/agent.schema';
import { Badge } from '@shared/ui/Badge';
import { Card } from '@shared/ui/Card';

/**
 * The panel that turns "chatbot" into "agent" for whoever is watching.
 *
 * It renders what the server reported it actually did — never what the interface guessed it would
 * do. A speculative row here would be a lie on a projector the one time a tool fails, and the
 * whole argument of the panel is that it is showing real work.
 *
 * Each row carries its own label from the tool registry, so adding a tool needs no change here.
 */

/** A compact one-line rendering of whatever the tool returned. */
function summarise(result: unknown): string {
	if (result === null || result === undefined) return '—';
	if (typeof result === 'string') return result;
	if (typeof result === 'number' || typeof result === 'boolean') return String(result);

	if (Array.isArray(result)) {
		return result.length === 0 ? 'нет результатов' : `результатов: ${String(result.length)}`;
	}

	if (typeof result === 'object') {
		return Object.entries(result)
			.map(([key, value]) => `${key}: ${typeof value === 'object' ? '…' : String(value)}`)
			.join(' · ');
	}

	return JSON.stringify(result);
}

/** The full value, indented, for the details block. `undefined` has no JSON form of its own. */
function pretty(value: unknown): string {
	return value === undefined ? '—' : JSON.stringify(value, null, 2);
}

function Detail({ title, value }: { title: string; value: unknown }) {
	return (
		<div className="mt-1.5">
			<p className="text-fg-muted text-xs">{title}</p>
			<pre className="bg-surface-sunken text-fg mt-0.5 max-h-60 overflow-auto rounded-sm p-2 text-xs">
				{pretty(value)}
			</pre>
		</div>
	);
}

function ActivityRow({ call }: { call: ToolCall }) {
	const ok = call.status === 'ok';
	const Icon = ok ? CheckCircleIcon : XCircleIcon;

	return (
		<li className="border-border flex items-start gap-2 border-b py-2.5 last:border-b-0">
			<Icon
				aria-hidden
				className={ok ? 'text-success mt-0.5 size-4 shrink-0' : 'text-danger mt-0.5 size-4 shrink-0'}
			/>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<code className="text-fg text-xs font-medium">{call.name}</code>
					{/* Status is never colour alone: the icon and this word carry it too. */}
					<Badge tone={ok ? 'success' : 'danger'}>{ok ? 'ok' : 'ошибка'}</Badge>
					<span className="text-fg-subtle ml-auto text-xs tabular-nums">{call.durationMs} мс</span>
				</div>

				<p className="text-fg-muted mt-0.5 text-xs">{call.label}</p>
				<p className="text-fg-subtle mt-1 truncate text-xs">{summarise(call.result)}</p>

				<details className="mt-1">
					<summary className="text-fg-muted hover:text-fg cursor-pointer text-xs">Подробнее</summary>
					<Detail title="Аргументы" value={call.arguments} />
					<Detail title="Результат" value={call.result} />
				</details>
			</div>
		</li>
	);
}

/** Matches the real row: icon, title line, two lines of text — so nothing jumps on arrival. */
function ActivitySkeleton() {
	return (
		<li className="border-border flex items-start gap-2 border-b py-2.5 last:border-b-0">
			<div className="bg-surface-sunken mt-0.5 size-4 shrink-0 animate-pulse rounded-full" />

			<div className="flex-1">
				<div className="bg-surface-sunken h-3.5 w-32 animate-pulse rounded-sm" />
				<div className="bg-surface-sunken mt-1.5 h-3 w-24 animate-pulse rounded-sm" />
				<div className="bg-surface-sunken mt-1.5 h-3 w-40 animate-pulse rounded-sm" />
			</div>
		</li>
	);
}

export interface AgentActivityProps {
	pending: boolean;
	toolCalls: readonly ToolCall[];
}

export function AgentActivity({ pending, toolCalls }: AgentActivityProps) {
	return (
		<Card
			action={<CpuChipIcon aria-hidden className="text-fg-subtle size-5" />}
			className="h-full"
			description="Что ассистент сделал за последний ход"
			title="Действия ассистента"
		>
			{toolCalls.length === 0 && !pending ? (
				<p className="text-fg-muted text-sm">
					Пока пусто. Отправьте сообщение — здесь появятся инструменты, которые ассистент выбрал сам.
				</p>
			) : (
				<ul aria-busy={pending} aria-live="polite" className="flex flex-col">
					{toolCalls.map((call, index) => (
						<ActivityRow call={call} key={`${call.name}-${String(index)}`} />
					))}

					{pending && <ActivitySkeleton />}
				</ul>
			)}
		</Card>
	);
}
