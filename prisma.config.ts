import { config as loadEnvFile } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env by itself.
loadEnvFile({ path: ['.env'], quiet: true });

/**
 * The datasource is attached only when the database is actually configured.
 *
 * `prisma generate` loads this file, and generation needs nothing but the schema — it does not
 * connect to anything. Declaring the URLs unconditionally made the config throw whenever they were
 * unset, which is the default state of this repository: the database is optional and off. The
 * effect was that `pnpm install` failed at its `postinstall` step on a clean clone, the generated
 * client was never written, and typecheck, lint, test and build then all failed on a missing
 * `./generated/client` — from a checkout that had done nothing wrong.
 *
 * That is the failure mode that ends a technical review, so the rule is: anything needed only to
 * *migrate* is read only when migrating.
 */
const migrateUrl = process.env.MIGRATE_DATABASE_URL;
const shadowUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
	/**
	 * Migrations run as the role that owns the schema, never as the application role. Two roles is
	 * what keeps a mistake in application code from being able to drop a table — and what makes Row
	 * Level Security possible later, since a table's owner is exempt from its own policies. See
	 * `docs/architecture.md`.
	 */
	...(migrateUrl === undefined
		? {}
		: {
				datasource: {
					...(shadowUrl === undefined ? {} : { shadowDatabaseUrl: shadowUrl }),
					url: migrateUrl,
				},
			}),
	migrations: {
		path: path.join('prisma', 'migrations'),
		// tsx rather than node's native type stripping: the generated Prisma client imports
		// without file extensions, which only a bundler-style resolver accepts.
		seed: 'tsx prisma/seed.ts',
	},
	schema: path.join('prisma', 'schema.prisma'),
});
