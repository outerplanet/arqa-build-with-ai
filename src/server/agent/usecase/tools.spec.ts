import { chatToolDefinitions, executeTool, responsesToolDefinitions, TOOLS } from '@server/agent/usecase/tools';
import { type Ctx } from '@server/kernel/ctx';
import { type PlacesContext } from '@server/places/usecase/context';
import { describe, expect, it, vi } from 'vitest';

const ctx: Ctx = { now: new Date('2026-01-15T09:30:00.000Z') };

describe('the tool registry', () => {
	it('gives every tool a unique name, because the model addresses them by it', () => {
		const names = TOOLS.map((tool) => tool.name);

		expect(new Set(names).size).toBe(names.length);
	});

	it('derives a JSON Schema for each tool rather than restating it by hand', () => {
		for (const definition of chatToolDefinitions()) {
			expect(definition.function.parameters).toMatchObject({ type: 'object' });
		}
	});

	it('strips $schema, which a validator wants and an inference endpoint does not', () => {
		for (const definition of responsesToolDefinitions()) {
			expect(definition.parameters).not.toHaveProperty('$schema');
		}
	});

	it('offers the same tools in both dialects', () => {
		expect(responsesToolDefinitions().map((tool) => tool.name)).toEqual(
			chatToolDefinitions().map((definition) => definition.function.name),
		);
	});
});

describe('executeTool', () => {
	it('keeps user interests and time budget when the live model omits route filters', async () => {
		const rankPlaces = vi.fn(() => []);
		const planWalk = vi.fn(() => ({ legs: [], note: 'Нет подходящих остановок', stops: [], totalMinutes: 0 }));
		const context: PlacesContext = {
			...ctx,
			browserLocation: { lat: 51.089, lon: 71.405 },
			places: {
				getPlaceById: () => null,
				lexicalScores: () => new Map(),
				planWalk,
				rankPlaces,
				readPlaces: () => [],
				readVectors: () => null,
			},
			userMessages: ['Я возле Mega, хочу прогуляться 30–60 минут'],
		};
		const call = await executeTool(context, {
			args: { durationMinutes: 120, start: context.browserLocation },
			name: 'plan_walk',
		});
		expect(call.status).toBe('ok');
		expect(rankPlaces).toHaveBeenCalledWith(
			expect.objectContaining({ categories: ['park', 'garden', 'viewpoint', 'artwork'] }),
		);
		expect(planWalk).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 60 }));
		await executeTool(context, { args: { at: '2020-01-01T00:00:00Z', query: 'прогулка' }, name: 'find_places' });
		expect(rankPlaces).toHaveBeenLastCalledWith(
			expect.objectContaining({ at: ctx.now, query: context.userMessages!.join('\n') }),
		);
	});
	it('waits for an asynchronous handler before reporting its result', async () => {
		const handler = vi.spyOn(TOOLS[0]!, 'handler').mockResolvedValue({ completed: true });

		try {
			expect(await executeTool(ctx, { args: {}, name: 'get_current_time' })).toMatchObject({
				result: { completed: true },
				status: 'ok',
			});
		} finally {
			handler.mockRestore();
		}
	});

	it('reports an asynchronous rejection as a failed activity row', async () => {
		const handler = vi
			.spyOn(TOOLS[0]!, 'handler')
			.mockImplementation(() => Promise.reject(new Error('Service unavailable')));

		try {
			expect(await executeTool(ctx, { args: {}, name: 'get_current_time' })).toMatchObject({
				status: 'error',
			});
		} finally {
			handler.mockRestore();
		}
	});

	it('runs a tool and reports success', async () => {
		const call = await executeTool(ctx, { args: {}, name: 'get_current_time' });

		expect(call.status).toBe('ok');
		expect(call.label).toBe('Проверка времени');
		expect(call.result).toMatchObject({ iso: '2026-01-15T09:30:00.000Z', timeZone: 'UTC' });
	});

	it('reads the clock from ctx and applies the requested zone', async () => {
		const call = await executeTool(ctx, { args: { timeZone: 'Asia/Almaty' }, name: 'get_current_time' });

		expect(call.result).toMatchObject({ timeZone: 'Asia/Almaty' });
		expect((call.result as { local: string }).local).toContain('14:30');
	});

	it('reports a hallucinated tool name instead of throwing', async () => {
		const call = await executeTool(ctx, { args: {}, name: 'summon_dragon' });

		expect(call.status).toBe('error');
		expect(call.result).toContain('summon_dragon');
	});

	it('rejects arguments that do not match the schema, rather than passing them through', async () => {
		const call = await executeTool(ctx, { args: { timeZone: 42 }, name: 'get_current_time' });

		expect(call.status).toBe('error');
	});

	/**
	 * The whole turn dies if this throws, and the activity panel — the one thing an audience is
	 * looking at — goes blank. A failing tool must be a row that says "failed".
	 */
	it('never rejects, even when the handler itself throws', async () => {
		const args = { timeZone: 'Not/A_Zone' };

		await expect(executeTool(ctx, { args, name: 'get_current_time' })).resolves.toMatchObject({ status: 'error' });
	});

	it('measures how long the handler took, because the panel shows it', async () => {
		expect((await executeTool(ctx, { args: {}, name: 'get_current_time' })).durationMs).toBeGreaterThanOrEqual(0);
	});
});
