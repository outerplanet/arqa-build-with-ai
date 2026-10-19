import { PrismaPg } from '@prisma/adapter-pg';
import { readEnv } from '@server/kernel/env';
import 'server-only';
import { PrismaClient } from './generated/client';

/**
 * The one Prisma client, and the only module allowed to hold it.
 *
 * Import it from the `db` tier only. A repo receives a `Tx` from `withTransaction` and uses
 * that; a usecase decides where the transaction begins and ends. Keeping the client behind
 * one module is what stops "just this once" queries appearing in a component.
 *
 * The exceptions are outside `src/`: `prisma/seed.ts` and migrations.
 *
 * The instance is cached on `globalThis` outside production because Next.js re-evaluates
 * modules on every hot reload in development, and a fresh connection pool per reload
 * exhausts the database's connection limit within a morning.
 */
function createPrismaClient() {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString: readEnv().DATABASE_URL }) });
}

const globalForPrisma = globalThis as typeof globalThis & {
	appPrismaClient?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.appPrismaClient ?? createPrismaClient();

if (readEnv().NODE_ENV !== 'production') {
	globalForPrisma.appPrismaClient = prisma;
}
