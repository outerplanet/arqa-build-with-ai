import { type ChatMessage } from '@server/agent/model/agent.schema';
import { runAgent } from '@server/agent/usecase/agent';
import { answerForTools } from '@server/agent/usecase/reply';
import { resetEnvCache } from '@server/kernel/env';
import { findPlacesResultSchema } from '@server/places/model/places.schema';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Follow-ups on real data through the scripted agent: the latest turn must always be visibly
 * handled — applied where the data allows it, said plainly where it does not.
 */
const ctx = { now: new Date('2026-10-19T10:00:00.000Z') };
const BAITEREK = { lat: 51.12829, lon: 71.43045 };

beforeEach(() => {
	process.env.LLM_PROVIDER = 'mock';
	delete process.env.LLM_API_KEY;
	resetEnvCache();
});

function conversation(...turns: string[]): ChatMessage[] {
	return turns.flatMap((content, index) => [
		{ content, role: 'user' as const },
		...(index < turns.length - 1 ? [{ content: 'Ответ.', role: 'assistant' as const }] : []),
	]);
}

async function ask(...turns: string[]) {
	return runAgent(ctx, { location: BAITEREK, messages: conversation(...turns) });
}

function searchOf(result: Awaited<ReturnType<typeof ask>>) {
	const call = result.toolCalls.findLast((item) => item.name === 'find_places');
	return { args: call?.arguments ?? {}, result: findPlacesResultSchema.parse(call?.result) };
}

describe('follow-up refinements', () => {
	it('acknowledges «мало денег», keeps the coffee interest and says prices are not in the data', async () => {
		const first = await ask('Ищу кофе возле Байтерека');
		const second = await ask('Ищу кофе возле Байтерека', 'У меня мало денег');

		expect(second.reply).not.toBe(first.reply);
		expect(second.reply).toContain('Учёл: мало денег.');
		expect(second.reply).toContain('Цен в данных OpenStreetMap нет — проверить стоимость не могу');
		expect(second.reply).toContain('«Открыть в 2ГИС»');
		expect(second.reply).toMatch(/Фильтры: [^\n]*Бюджет: цены не проверены/u);
		// Still coffee, and searched again on this turn.
		expect(second.toolCalls.map((call) => call.name)).toContain('find_places');
		expect(searchOf(second).args.categories).toEqual(['cafe', 'library']);
		expect(second.reply).toContain('совпадает с запросом «кофе»');
		// The acknowledgement comes right after the location and filters lines.
		const paragraphs = second.reply.split('\n\n');
		expect(paragraphs[0]).toMatch(/^Локация: /u);
		expect(paragraphs[1]).toMatch(/^Фильтры: /u);
		expect(paragraphs[2]).toMatch(/^Учёл: мало денег\./u);
		expect(second.recommendedPlaceIds).toEqual(second.recommendations?.map((item) => item.placeId));
	});

	it('«поближе» shrinks the walking radius and lists places from the nearest', async () => {
		const first = await ask('Ищу кофе возле Байтерека');
		const closer = await ask('Ищу кофе возле Байтерека', 'А поближе?');
		const before = searchOf(first).args.maxWalkMinutes as number;
		const after = searchOf(closer).args.maxWalkMinutes as number;

		expect(after).toBeLessThan(before);
		expect(closer.reply).toContain('Учёл: поближе.');
		expect(closer.reply).toMatch(/Фильтры: [^\n]*Поближе: по расстоянию/u);
		const distances = closer.recommendations?.map((item) => item.distanceM) ?? [];
		expect(distances.length).toBeGreaterThan(0);
		expect(distances).toEqual(distances.toSorted((left, right) => left - right));
		for (const item of closer.recommendations ?? []) expect(item.walkMinutes).toBeLessThanOrEqual(after);
	});

	it('«открыто сейчас» keeps only places open by their OSM hours', async () => {
		const result = await ask('Ищу кофе возле Байтерека', 'Только то, что открыто сейчас');
		const { result: found } = searchOf(result);
		const open = new Set(
			found.candidates
				.filter((candidate) => candidate.open.status === 'open')
				.map((candidate) => candidate.place.id),
		);

		expect(result.reply).toContain('Учёл: открыто сейчас.');
		expect(result.reply).toMatch(/Фильтры: [^\n]*Только открытые сейчас/u);
		const ids = result.recommendedPlaceIds ?? [];
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(open.has(id)).toBe(true);
	});

	it('says plainly when a follow-up was not understood instead of repeating silently', async () => {
		const result = await ask('Ищу кофе возле Байтерека', 'Хм, а как насчёт фиолетового?');

		expect(result.reply.split('\n\n')[0]).toBe(
			[
				'Не понял уточнение «Хм, а как насчёт фиолетового?» — учёл прежний запрос: кофе рядом с вами.',
				'Могу учесть: расстояние, время, часы работы, категорию, доступность.',
			].join(' '),
		);
		expect(searchOf(result).args.categories).toEqual(['cafe', 'library']);
	});

	it('names the landmark in the not-understood line when the location came from the words', async () => {
		const result = await runAgent(ctx, {
			messages: conversation('Ищу кофе возле Байтерека', 'Хм, а как насчёт фиолетового?'),
		});

		expect(result.reply).toMatch(/^Не понял уточнение «[^»]+» — учёл прежний запрос: кофе рядом с «[^»]*Байтерек/iu);
	});

	it('keeps «тихо» and «бесплатно» honest: acknowledged, never claimed as checked', async () => {
		const result = await ask('Ищу кофе возле Байтерека', 'Хочу бесплатно и потише');

		expect(result.reply).toContain('Учёл: бесплатно, тихо.');
		expect(result.reply).toContain('Уровня шума в данных нет');
		expect(result.reply).toMatch(/Бесплатный вход ни у одного из предложенных мест в OpenStreetMap не отмечен/u);
	});

	it('a later interest still switches the search', async () => {
		const result = await ask('Ищу кофе возле Байтерека', 'У меня мало денег', 'А теперь музей');

		expect(searchOf(result).args.categories).toEqual(['museum', 'gallery']);
		expect(result.reply).toContain('Учёл: мало денег.');
		expect(result.reply).not.toContain('Не понял уточнение');
	});

	it('does not call small talk a misunderstood refinement', async () => {
		expect((await ask('Ищу кофе возле Байтерека', 'Спасибо!')).reply).not.toContain('Не понял');
	});
});

describe('honest, varied reasons', () => {
	it('claims only the interests the data confirms: sockets stay «данных нет»', async () => {
		const result = await ask('Хочу кофе с розеткой');

		expect(result.reply).not.toContain('«кофе, розетка»');
		expect(result.reply).toContain('совпадает с запросом «кофе»');
		expect(result.reply).toContain('Розетки: данных нет — уточните перед выходом.');
	});

	it('never repeats the same «почему» or «что делать» within one answer', async () => {
		for (const turns of [['Ищу кофе возле Байтерека'], ['Хочу в музей'], ['Построй прогулку на 2 часа']]) {
			// eslint-disable-next-line no-await-in-loop -- one conversation at a time, for readable failures
			const result = await ask(...turns);
			const items = result.recommendations ?? [];
			expect(new Set(items.map((item) => item.why)).size).toBe(items.length);
			expect(new Set(items.map((item) => item.action)).size).toBe(items.length);
		}
	});

	it('gives a route its own filters paragraph with the start, even without a separate search', async () => {
		const full = await ask('Построй прогулку на 2 часа');
		const routeOnly = full.toolCalls.filter((call) => call.name === 'plan_walk');
		expect(routeOnly).toHaveLength(1);
		const answer = answerForTools(
			{ ...ctx, browserLocation: BAITEREK, userMessages: ['Построй прогулку на 2 часа'] },
			{ messages: conversation('Построй прогулку на 2 часа'), toolCalls: routeOnly },
		);

		expect(answer.reply.split('\n\n')).toContainEqual(
			expect.stringMatching(/^Фильтры: Старт: геолокация браузера;/u),
		);
		expect(answer.reply).toMatch(/^Локация: /u);
	});
});
