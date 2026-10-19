import { runAgent } from '@server/agent/usecase/agent';
import { type Ctx } from '@server/kernel/ctx';
import { resetEnvCache } from '@server/kernel/env';
import { beforeEach, describe, expect, it } from 'vitest';

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

	it('every reported call carries what the panel renders', async () => {
		const result = await runAgent(ctx, { messages: [{ content: 'hello', role: 'user' }] });

		for (const call of result.toolCalls) {
			expect(call.label.length).toBeGreaterThan(0);
			expect(call.status).toBe('ok');
		}
	});
});
