import { type ChatMessage, type ChatResponse, type ToolCall } from '@server/agent/model/agent.schema';
import { type Ctx } from '@server/kernel/ctx';
import { readEnv } from '@server/kernel/env';
import 'server-only';
import { type ChatMessageParam, createClient, type ResponseItem, type ResponsesTool, withRetry } from './client';
import { SYSTEM_PROMPT } from './prompt';
import { chatToolDefinitions, type CurrentTime, executeTool, responsesToolDefinitions } from './tools';

/**
 * The agent loop, in three dialects that behave identically from the outside.
 *
 * Whichever one runs, the tools are the same objects and `executeTool` is the same function, so a
 * rule enforced in a handler holds on every path — including the scripted one. That is the point
 * of keeping the mock: it is not a stub of the product, it is the product with the model removed.
 *
 * `runAgent` is the only thing outside this file that anyone should need.
 */

/**
 * A confused model must not be able to hang the demo — but the cap has to clear the honest path
 * first. A real task legitimately spends several calls on tools and one more on the answer, so a
 * tight cap silently turns a working turn into "I could not finish", which reads as a bug in the
 * product rather than a limit. Ten leaves room for a stray call and still bounds a loop.
 */
const MAX_TURNS = 10;

export interface AgentInput {
	messages: readonly ChatMessage[];
}

/** A model can emit malformed JSON. An empty object gets a validation error from the tool, which
 *  it can read and correct — a thrown parse error ends the turn with nothing to show. */
function parseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw);

		return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function contextMessage(ctx: Ctx): string {
	return `Today is ${ctx.now.toISOString().slice(0, 10)}.`;
}

const EXHAUSTED = 'I could not finish this request. Please rephrase it, or ask a person who can help directly.';

// --- the Responses adapter ----------------------------------------------------------------------

/**
 * OpenAI's own dialect, and the default.
 *
 * It is the only one that can be handed hosted tools — `web_search` and `file_search` — which is
 * how this product searches the web or a set of uploaded documents without a line of retrieval
 * code, a vector database or an embedding pipeline of ours.
 */
async function runResponses(ctx: Ctx, input: AgentInput): Promise<ChatResponse> {
	const env = readEnv();
	const client = createClient();
	const toolCalls: ToolCall[] = [];

	const hosted: Record<string, unknown>[] = [
		...(env.OPENAI_VECTOR_STORE_ID === undefined
			? []
			: [{ type: 'file_search', vector_store_ids: [env.OPENAI_VECTOR_STORE_ID] }]),
		...(env.OPENAI_WEB_SEARCH ? [{ type: 'web_search' }] : []),
	];

	const conversation: ResponseItem[] = [
		{ content: SYSTEM_PROMPT, role: 'system' },
		{ content: contextMessage(ctx), role: 'system' },
		...input.messages.map((message) => ({ content: message.content, role: message.role })),
	];

	for (let turn = 0; turn < MAX_TURNS; turn += 1) {
		// eslint-disable-next-line no-await-in-loop -- an agent loop is a sequence, not a batch
		const response = await withRetry(() =>
			client.responses.create({
				input: conversation,
				model: env.LLM_MODEL,
				// Nothing is kept on the provider's side: the whole conversation is resent each
				// turn, which is also what makes the transcript ours rather than theirs.
				store: false,
				tools: [...responsesToolDefinitions(), ...hosted] as ResponsesTool[],
			}),
		);

		// The model's own items go back in verbatim, reasoning included — dropping them is what
		// makes a reasoning model repeat a tool call it has already made.
		conversation.push(...(response.output as ResponseItem[]));

		const requested = response.output.filter((item) => item.type === 'function_call');

		if (requested.length === 0) {
			return { reply: response.output_text, toolCalls };
		}

		for (const call of requested) {
			const executed = executeTool(ctx, { args: parseArgs(call.arguments), name: call.name });

			toolCalls.push(executed);
			conversation.push({
				call_id: call.call_id,
				output: JSON.stringify(executed.result),
				type: 'function_call_output',
			});
		}
	}

	return { reply: EXHAUSTED, toolCalls };
}

// --- the Chat Completions adapter ---------------------------------------------------------------

/**
 * The portable dialect. NVIDIA NIM, Groq, Together, Fireworks, vLLM and OpenAI all speak it, so
 * this is the path that keeps working when credits run out or one endpoint is saturated.
 *
 * No hosted tools here — that is the trade. Our own tools are identical.
 */
async function runChat(ctx: Ctx, input: AgentInput): Promise<ChatResponse> {
	const env = readEnv();
	const client = createClient();
	const toolCalls: ToolCall[] = [];

	const conversation: ChatMessageParam[] = [
		{ content: SYSTEM_PROMPT, role: 'system' },
		{ content: contextMessage(ctx), role: 'system' },
		...input.messages.map((message) => ({ content: message.content, role: message.role })),
	];

	for (let turn = 0; turn < MAX_TURNS; turn += 1) {
		// eslint-disable-next-line no-await-in-loop -- see above
		const completion = await withRetry(() =>
			client.chat.completions.create({
				messages: conversation,
				model: env.LLM_MODEL,
				tools: chatToolDefinitions(),
			}),
		);

		const choice = completion.choices[0]?.message;

		if (choice === undefined) break;

		if (choice.tool_calls === undefined || choice.tool_calls.length === 0) {
			return { reply: choice.content ?? '', toolCalls };
		}

		conversation.push(choice);

		for (const requested of choice.tool_calls.filter((candidate) => candidate.type === 'function')) {
			const executed = executeTool(ctx, {
				args: parseArgs(requested.function.arguments),
				name: requested.function.name,
			});

			toolCalls.push(executed);
			conversation.push({
				content: JSON.stringify(executed.result),
				role: 'tool',
				tool_call_id: requested.id,
			});
		}
	}

	return { reply: EXHAUSTED, toolCalls };
}

// --- the scripted adapter -----------------------------------------------------------------------

/**
 * The demo without a network, a key or a credit balance.
 *
 * Two things depend on this. Dead venue wifi becomes an inconvenience rather than the end of the
 * presentation — and a reviewer can run the whole main scenario without being handed anybody's
 * API key, which is a condition of the technical check rather than a convenience.
 *
 * It calls the real tools through the real dispatcher, so the rows in the activity panel are
 * genuine and rule 1 binds it exactly as it binds a model: every fact in the reply comes from a
 * tool result. It has one branch because the starter has one tool. When the product's tools
 * arrive, script the main scenario here — and for a tool that writes, propose first and act only
 * on an explicit confirmation in a later message, as prompt rule 2 demands of a model.
 */
function runMock(ctx: Ctx, _input: AgentInput): ChatResponse {
	const call = executeTool(ctx, { args: {}, name: 'get_current_time' });

	if (call.status === 'error') {
		return { reply: `The clock tool failed: ${String(call.result)}`, toolCalls: [call] };
	}

	const time = call.result as CurrentTime;

	return {
		reply: `Mock mode — no model is connected. The server clock reads ${time.local} (${time.timeZone}).`,
		toolCalls: [call],
	};
}

// --- the entry point ----------------------------------------------------------------------------

export async function runAgent(ctx: Ctx, input: AgentInput): Promise<ChatResponse> {
	switch (readEnv().LLM_PROVIDER) {
		case 'chat':
			return runChat(ctx, input);

		case 'mock':
			return Promise.resolve(runMock(ctx, input));

		case 'responses':
		default:
			return runResponses(ctx, input);
	}
}
