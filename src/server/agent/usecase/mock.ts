import { type ChatMessage, type ChatResponse, type ToolCall } from '@server/agent/model/agent.schema';
import { resolvedLocationSchema } from '@server/places/model/places.schema';
import { type PlacesContext } from '@server/places/usecase/context';
import { LANDMARKS, mentions } from '@server/places/usecase/landmarks';
import { origin } from '@server/places/usecase/origin';
import 'server-only';
import { answerForTools } from './reply';
import { categoriesFor, scenarioFor } from './scenario';
import { type CurrentTime, executeTool } from './tools';

/** The user says where they are («я на набережной»), not how long or how they travel («я на час»). */
const AT_PLACE = /возле|около|нахожусь|я у |я (?:сейчас )?на (?!\d|час|полчаса|пару|машин|такси)|рядом с |на улице/iu;

export async function runMock(ctx: PlacesContext, input: { messages: readonly ChatMessage[] }): Promise<ChatResponse> {
	const userMessages = input.messages.filter((message) => message.role === 'user');
	const latest = userMessages.at(-1)?.content ?? '';
	const toolCalls: ToolCall[] = [];

	if (/который час|what time|текущее время|время сейчас/iu.test(latest)) {
		const call = await executeTool(ctx, { args: { timeZone: 'Asia/Almaty' }, name: 'get_current_time' });
		const time = call.result as CurrentTime;

		return {
			reply: call.status === 'ok' ? `По серверным часам: ${time.local} (${time.timeZone}).` : String(call.result),
			toolCalls: [call],
		};
	}
	if (ctx.browserLocation === undefined) {
		const locationMessage = [...userMessages]
			.reverse()
			.find(
				(message) =>
					LANDMARKS.some((aliases) => aliases.some((alias) => mentions(message.content, alias))) ||
					AT_PLACE.test(message.content),
			);

		if (locationMessage !== undefined) {
			const call = await executeTool(ctx, { args: { text: locationMessage.content }, name: 'resolve_location' });

			toolCalls.push(call);
			const resolved = resolvedLocationSchema.safeParse(call.result);

			if (call.status === 'error' || !resolved.success || !resolved.data.found) {
				return { ...answerForTools(ctx, { messages: input.messages, toolCalls }), toolCalls };
			}
		} else {
			return { ...answerForTools(ctx, { messages: input.messages, toolCalls }), toolCalls };
		}
	}
	const scenario = scenarioFor(userMessages.map((message) => message.content).join('\n'));
	const search = await executeTool(ctx, {
		args: {
			accessibleOnly: scenario.accessibleOnly,
			categories: categoriesFor(scenario, { purpose: 'search' }),
			limit: 5,
			maxWalkMinutes: scenario.maxWalkMinutes,
			query: scenario.query,
		},
		name: 'find_places',
	});

	toolCalls.push(search);
	if (
		search.status === 'ok' &&
		scenario.route &&
		!scenario.flight &&
		!scenario.night &&
		(scenario.durationMinutes ?? 0) >= 20
	) {
		toolCalls.push(
			await executeTool(ctx, {
				args: {
					categories: categoriesFor(scenario, { purpose: 'route' }),
					durationMinutes: scenario.durationMinutes,
					query: scenario.query,
					start: origin(ctx).point,
				},
				name: 'plan_walk',
			}),
		);
	}
	return { ...answerForTools(ctx, { messages: input.messages, toolCalls }), toolCalls };
}
