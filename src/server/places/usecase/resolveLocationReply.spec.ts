import { runAgent } from '@server/agent/usecase/agent';
import { resetEnvCache } from '@server/kernel/env';
import { resolvedLocationSchema } from '@server/places/model/places.schema';
import 'server-only';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock agent, real tools, committed data/poi.json: what the user reads when a landmark is missing.
const ctx = { now: new Date('2026-10-19T07:00:00Z') };

beforeEach(() => {
	vi.stubEnv('LLM_PROVIDER', 'mock');
	resetEnvCache();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

async function ask(text: string) {
	return runAgent(ctx, { messages: [{ content: text, role: 'user' as const }] });
}

function resolved(answer: Awaited<ReturnType<typeof ask>>) {
	return resolvedLocationSchema.parse(answer.toolCalls.find((call) => call.name === 'resolve_location')?.result);
}

describe('honest location replies through the mock agent', () => {
	it.each([
		['Я на набережной, хочу кофе', 'набережной'],
		['Я у Ак Орды, хочу погулять час', 'Ак Орды'],
		['Я у Ак Орды…', 'Ак Орды'],
	])('says the place is not in the data: %s', async (text, missing) => {
		const answer = await ask(text);
		expect(resolved(answer).found).toBe(false);
		expect(answer.reply).toContain(`Не нашёл «${missing}» в данных OpenStreetMap`);
		expect(answer.reply).toContain('«Использовать мою геолокацию»');
		expect(answer.toolCalls.some((call) => call.name === 'find_places')).toBe(false);
	});

	it.each([
		['Я у Байтэрека, хочу прогуляться на час', 'osm:way/230401645'],
		['Я у Триумфальной арки, хочу прогуляться на час', 'osm:way/549307755'],
	])('resolves and recommends: %s', async (text, id) => {
		const answer = await ask(text);
		expect(resolved(answer)).toMatchObject({ found: true, matchedPlaceId: id });
		expect(answer.toolCalls.some((call) => call.name === 'find_places')).toBe(true);
	});
});
