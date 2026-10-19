import { runAgent } from '@server/agent/usecase/agent';
import { type Ctx } from '@server/kernel/ctx';
import { resetEnvCache } from '@server/kernel/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({ chat: vi.fn(), responses: vi.fn() }));

vi.mock('@server/agent/usecase/client', () => ({
	createClient: () => ({
		chat: { completions: { create: provider.chat } },
		responses: { create: provider.responses },
	}),
	withRetry: <T>(call: () => Promise<T>) => call(),
}));

/**
 * These exercise the scripted adapter, which is the only one that can run in a test without a
 * network or a key — and the one a reviewer runs. It calls the real tools through the real
 * dispatcher, so what is asserted here is the product, not a stub of it.
 */
const ctx: Ctx = { now: new Date('2026-01-15T09:30:00.000Z') };

beforeEach(() => {
	process.env.LLM_PROVIDER = 'mock';
	delete process.env.LLM_API_KEY;
	resetEnvCache();
});

describe('the scripted agent', () => {
	/** The exact sentence the README tells a reviewer to type. It must not rot. */
	it('answers the question the README tells a reviewer to ask by calling a tool', async () => {
		const result = await runAgent(ctx, { messages: [{ content: 'What time is it?', role: 'user' }] });

		expect(result.toolCalls.map((call) => call.name)).toEqual(['get_current_time']);
	});

	/** Rule 1: every fact in the reply comes from what the tool returned. */
	it('composes the reply from the tool result', async () => {
		const result = await runAgent(ctx, { messages: [{ content: 'What time is it?', role: 'user' }] });
		const time = result.toolCalls[0]?.result as { local: string; timeZone: string };

		expect(result.reply).toContain(time.local);
		expect(result.reply).toContain(time.timeZone);
	});

	it('answers a coffee request with a concrete reason and one hours sentence', async () => {
		const result = await runAgent(
			{ now: new Date('2026-10-19T10:00:00.000Z') },
			{ location: { lat: 51.089, lon: 71.416 }, messages: [{ content: 'Хочу кофе', role: 'user' }] },
		);

		expect(result.reply).toContain('совпадает с запросом «кофе»');
		expect(result.reply).not.toMatch(/по данным источника|\. по данным OSM/u);
		expect(result.recommendations?.map((item) => item.order)).toEqual(
			result.recommendations?.map((_, index) => index + 1),
		);
	});

	it('every reported call carries what the panel renders', async () => {
		const result = await runAgent(ctx, { messages: [{ content: 'Который час?', role: 'user' }] });

		for (const call of result.toolCalls) {
			expect(call.label.length).toBeGreaterThan(0);
			expect(call.status).toBe('ok');
		}
	});
});

describe('the live adapters', () => {
	const location = { lat: 51.089, lon: 71.416 };
	const search = { arguments: JSON.stringify({ query: 'кофе' }), name: 'find_places' };

	function useProvider(name: 'chat' | 'responses') {
		process.env.LLM_PROVIDER = name;
		process.env.LLM_API_KEY = 'test-key';
		resetEnvCache();
	}

	afterEach(() => {
		delete process.env.LLM_API_KEY;
		process.env.LLM_PROVIDER = 'mock';
		resetEnvCache();
		provider.chat.mockReset();
		provider.responses.mockReset();
	});

	it('keeps executed tool calls and answers from them when the provider fails mid-turn', async () => {
		useProvider('chat');
		provider.chat
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content: null,
							role: 'assistant',
							tool_calls: [{ function: search, id: 'c1', type: 'function' }],
						},
					},
				],
			})
			.mockRejectedValueOnce(new Error('provider down'));
		const result = await runAgent(ctx, { location, messages: [{ content: 'Хочу кофе', role: 'user' }] });

		expect(result.toolCalls.map((call) => call.name)).toEqual(['find_places']);
		expect(result.reply).toContain('Локация:');
		// The fallback answer carries the same structured cards as any other path.
		expect(result.recommendations?.length).toBeGreaterThan(0);
		expect(result.recommendedPlaceIds).toEqual(result.recommendations?.map((item) => item.placeId));
	});

	it.each(['chat', 'responses'] as const)('returns structured recommendations from the %s dialect', async (name) => {
		useProvider(name);
		if (name === 'chat')
			provider.chat
				.mockResolvedValueOnce({
					choices: [
						{
							message: {
								content: null,
								role: 'assistant',
								tool_calls: [{ function: search, id: 'c1', type: 'function' }],
							},
						},
					],
				})
				.mockResolvedValueOnce({ choices: [{ message: { content: 'Готово', role: 'assistant' } }] });
		else
			provider.responses
				.mockResolvedValueOnce({ output: [{ call_id: 'r1', type: 'function_call', ...search }] })
				.mockResolvedValueOnce({ output: [{ content: [], role: 'assistant', type: 'message' }] });
		const result = await runAgent(ctx, { location, messages: [{ content: 'Хочу кофе', role: 'user' }] });

		expect(result.recommendations?.length).toBeGreaterThan(0);
		expect(result.recommendedPlaceIds).toEqual(result.recommendations?.map((item) => item.placeId));
		for (const item of result.recommendations!) expect(result.reply).toContain(`Почему: ${item.why}.`);
	});

	it('answers from a successful search when the turn budget runs out', async () => {
		useProvider('responses');
		provider.responses.mockResolvedValue({ output: [{ call_id: 'r1', type: 'function_call', ...search }] });
		const result = await runAgent(ctx, { location, messages: [{ content: 'Хочу кофе', role: 'user' }] });

		expect(result.toolCalls.length).toBeGreaterThan(0);
		expect(result.reply).toContain('Локация:');
		expect(result.reply).not.toContain('Не удалось завершить запрос');
	});

	it('still reports a provider failure before any tool ran as an error', async () => {
		useProvider('responses');
		provider.responses.mockRejectedValue(new Error('provider down'));

		await expect(runAgent(ctx, { location, messages: [{ content: 'Хочу кофе', role: 'user' }] })).rejects.toThrow();
	});
});
