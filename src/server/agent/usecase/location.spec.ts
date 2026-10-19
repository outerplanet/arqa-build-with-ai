import { runAgent } from '@server/agent/usecase/agent';
import { createClient } from '@server/agent/usecase/client';
import { TOOLS } from '@server/agent/usecase/tools';
import { resetEnvCache } from '@server/kernel/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@server/agent/usecase/client', () => ({
	createClient: vi.fn(),
	withRetry: <T>(call: () => Promise<T>) => call(),
}));

const ctx = { now: new Date('2026-10-19T08:00:00Z') };
const messages = [{ content: 'Хочу прогуляться', role: 'user' as const }];
const chat = vi.fn();
const responses = vi.fn();

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('LLM_API_KEY', 'test-key');
	resetEnvCache();
	chat.mockResolvedValue({ choices: [{ message: { content: 'Где вы?', role: 'assistant' } }] });
	responses.mockResolvedValue({ output: [], output_text: 'Где вы?' });
	vi.mocked(createClient).mockReturnValue({
		chat: { completions: { create: chat } },
		responses: { create: responses },
	} as unknown as ReturnType<typeof createClient>);
});

afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe.each(['chat', 'responses'])('location sent through the %s adapter', (provider) => {
	it('renders the clock tool result in a live adapter without asking for location', async () => {
		vi.stubEnv('LLM_PROVIDER', provider);
		chat.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						role: 'assistant',
						tool_calls: [
							{
								function: { arguments: '{"timeZone":"Asia/Almaty"}', name: 'get_current_time' },
								id: 'clock-1',
								type: 'function',
							},
						],
					},
				},
			],
		});
		responses.mockResolvedValueOnce({
			output: [
				{
					arguments: '{"timeZone":"Asia/Almaty"}',
					call_id: 'clock-1',
					name: 'get_current_time',
					type: 'function_call',
				},
			],
		});
		const result = await runAgent(ctx, { messages: [{ content: 'Который час?', role: 'user' }] });

		expect(result.reply).toContain('13:00');
		expect(result.reply).toContain('Asia/Almaty');
		expect(result.reply).not.toContain('Где вы');
	});

	it('sends the resolved asynchronous tool result back to the provider', async () => {
		vi.stubEnv('LLM_PROVIDER', provider);
		const handler = vi.spyOn(TOOLS[0]!, 'handler').mockResolvedValue({ completed: true });
		chat.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						role: 'assistant',
						tool_calls: [
							{ function: { arguments: '{}', name: 'get_current_time' }, id: 'call-1', type: 'function' },
						],
					},
				},
			],
		});
		responses.mockResolvedValueOnce({
			output: [{ arguments: '{}', call_id: 'call-1', name: 'get_current_time', type: 'function_call' }],
		});

		try {
			const result = await runAgent(ctx, { messages });

			expect(result.toolCalls[0]?.result).toEqual({ completed: true });
			const calls = provider === 'chat' ? chat.mock.calls : responses.mock.calls;

			expect(calls).toHaveLength(2);
			expect(JSON.stringify(calls[1])).toContain(JSON.stringify(JSON.stringify({ completed: true })));
		} finally {
			handler.mockRestore();
		}
	});

	it('rounds direct caller coordinates before passing them to a provider', async () => {
		vi.stubEnv('LLM_PROVIDER', provider);
		await runAgent(ctx, { location: { lat: 51.123456, lon: 71.456789 }, messages });
		const payload = JSON.stringify(provider === 'chat' ? chat.mock.calls : responses.mock.calls);

		expect(payload).toContain('51.123');
		expect(payload).toContain('71.457');
		expect(payload).toContain('Источник локации: браузер');
		expect(payload).not.toContain('51.123456');
		expect(payload).not.toContain('71.456789');
	});

	it('tells the model to ask for a location when browser coordinates are absent', async () => {
		vi.stubEnv('LLM_PROVIDER', provider);
		await runAgent(ctx, { messages });
		const payload = JSON.stringify(provider === 'chat' ? chat.mock.calls : responses.mock.calls);

		expect(payload).toContain('Геолокация браузера не передана');
		expect(payload).toContain('спросите, где он находится');
	});

	it('rejects invalid direct caller coordinates before making a provider call', async () => {
		vi.stubEnv('LLM_PROVIDER', provider);
		await expect(runAgent(ctx, { location: { lat: 91, lon: 71 }, messages })).rejects.toThrow();
		expect(createClient).not.toHaveBeenCalled();
	});
});
