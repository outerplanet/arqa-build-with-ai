import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/server/db/generated/client';

// No dotenv here: prisma.config.ts loads .env, and this script is spawned by the CLI that
// read it, so the values are already in the environment.

/**
 * Enough rows to open the application and see something.
 *
 * A seed is fixtures, not operational data: it must be safe to run twice, so everything here
 * is an upsert or a `skipDuplicates` insert. Anything a real user would type belongs in the
 * interface instead.
 */
const USER = {
	email: 'dev@example.com',
	id: '01999000-0000-7000-8000-000000000001',
	name: 'Dev User',
};

async function main() {
	const connectionString = process.env.MIGRATE_DATABASE_URL;

	if (!connectionString) {
		throw new Error('MIGRATE_DATABASE_URL is not set. See .env.example.');
	}

	const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

	try {
		const user = await prisma.user.upsert({
			create: USER,
			update: { name: USER.name },
			where: { id: USER.id },
		});

		console.log(`seeded: user "${user.email}" (${user.id})`);
	} finally {
		await prisma.$disconnect();
	}
}

// Not top-level await: tsx loads this file as CommonJS, where an async module is a
// hard error (ERR_REQUIRE_ASYNC_MODULE) rather than something it can transpile away.
void main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
