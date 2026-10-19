import { config as loadEnvFile } from 'dotenv';
import { defineConfig } from 'vitest/config';

// First file wins, and dotenv never overwrites a variable that is already set, so an
// explicit variable in the shell beats .env.test, which beats .env. That ordering is what
// keeps `pnpm test` on the scripted provider instead of a developer's real key.
loadEnvFile({ path: ['.env.test.local', '.env.test', '.env'], quiet: true });

export default defineConfig({
	resolve: { tsconfigPaths: true },

	/**
	 * `server-only` exports an empty module under React's `react-server` condition and one
	 * that throws under every other. Every file in src/server imports it deliberately, so
	 * without this condition all of them are untestable.
	 *
	 * It has to be `ssr.resolve`, not `resolve`. Vitest runs node tests through Vite's SSR
	 * pipeline, and since Vite 6 the two have separate condition lists; setting the client
	 * one has no effect here, which looks exactly like the option not working.
	 */
	ssr: {
		// 'module' is deliberately absent. Some packages map that condition to an ESM build that
		// does `export * from './dir'` — a directory import Node refuses in ESM — while their
		// `default` entry is CommonJS and loads. The first active condition wins, so leaving
		// 'module' out is what keeps those resolvable.
		resolve: { conditions: ['react-server', 'node'] },
	},
	test: {
		projects: [
			{
				test: {
					environment: 'node',
					include: ['src/**/*.spec.ts'],
					name: 'unit',
				},
			},
		],
	},
});
