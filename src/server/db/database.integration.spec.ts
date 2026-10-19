import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from './generated/client';

/**
 * The integration harness, proved end to end.
 *
 * Its job is not to test Prisma. It is to fail loudly on the day the harness stops working —
 * `vitest.globalSetup.ts` refusing a non-test database, `prisma migrate deploy` running against
 * it, the roles and grants from `docker/postgres/init` being in place. Without one test that
 * actually touches the database, all of that can rot for weeks and nothing notices, because a
 * project with zero integration tests passes its suite perfectly.
 *
 * The client is built here rather than imported from `./client`: that module reads
 * `DATABASE_URL` once at import time and caches on `globalThis`, which is right for a server
 * and wrong for a test that wants to be explicit about which database it is talking to.
 */
const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

afterAll(async () => {
	await prisma.$disconnect();
});

describe('the test database', () => {
	it('is reachable as the application role', async () => {
		const rows = await prisma.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;

		expect(rows[0]?.role).toBe('app_user');
	});

	it('has the migrated schema, not an empty one', async () => {
		// A count, not a create: this asserts the table exists and is readable. If migrations
		// did not run, Prisma raises P2021 here rather than returning zero.
		await expect(prisma.user.count()).resolves.toBeTypeOf('number');
	});

	it('round-trips a row with the schema defaults applied', async () => {
		const user = await prisma.user.create({
			data: { email: `harness-${crypto.randomUUID()}@example.test`, name: 'Harness' },
		});

		try {
			expect(user.createdAt).toBeInstanceOf(Date);
			expect(user.status).toBe('active');
			await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({ name: 'Harness' });
		} finally {
			await prisma.user.delete({ where: { id: user.id } });
		}
	});

	it('refuses two users with the same email', async () => {
		const email = `duplicate-${crypto.randomUUID()}@example.test`;
		const user = await prisma.user.create({ data: { email, name: 'First' } });

		try {
			await expect(prisma.user.create({ data: { email, name: 'Second' } })).rejects.toThrow();
		} finally {
			await prisma.user.delete({ where: { id: user.id } });
		}
	});
});
