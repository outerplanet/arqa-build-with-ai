import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './scenarios';

describe('SCENARIOS', () => {
	it('covers the case: Expo example and the five user scenarios', () => {
		const queries = SCENARIOS.map((scenario) => scenario.query);
		expect(queries).toHaveLength(6);
		for (const keyword of ['Экспо 2017', 'Mega Silk Way', 'розетк', 'ребёнком', 'вылетом', 'ночную']) {
			expect(queries.some((query) => query.includes(keyword))).toBe(true);
		}
	});

	it('names landmarks in the nominative after «у здания» / «возле»', () => {
		expect(SCENARIOS[0]?.query).toContain('у здания Экспо 2017');
		expect(SCENARIOS[1]?.query).toContain('возле Mega Silk Way');
	});

	it('marks exactly the scenarios without a landmark as needing the browser location', () => {
		const needLocation = SCENARIOS.filter((scenario) => scenario.needsLocation);
		expect(needLocation).toHaveLength(4);
		for (const scenario of needLocation) {
			expect(scenario.query).not.toMatch(/Экспо|Mega/u);
		}
	});
});
