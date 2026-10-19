import 'server-only';
import { prisma } from './client';
import { toDomainError } from './errors';
import { type Prisma } from './generated/client';

/**
 * What a repo is handed. A repo never opens a transaction and never imports the client;
 * it takes a `Tx` and uses it. See `docs/architecture.md`, "Transactions".
 */
export type Tx = Prisma.TransactionClient;

/**
 * The only place a transaction is opened. A usecase owns it; everything below receives it.
 *
 * Without a single owner you get nested transactions, partial commits, and a side effect that
 * outlives the change it announced. Keeping the boundary in one function is what makes "this
 * either all happened or none of it did" a property of the code rather than a hope.
 *
 * Database failures are translated on the way out, so a caller sees a `DomainError` with a
 * `kind` it can branch on instead of a Prisma message carrying absolute file paths.
 */
export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
	try {
		return await prisma.$transaction(async (tx) => run(tx));
	} catch (error) {
		throw toDomainError(error);
	}
}
