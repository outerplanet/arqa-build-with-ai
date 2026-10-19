import { DomainError, isDomainError } from '@server/kernel/errors';
import { describe, expect, it } from 'vitest';
import { sqlStateOf, toDomainError } from './errors';

/**
 * The decision table.
 *
 * The fixtures are shaped exactly as Prisma 7 with the pg driver adapter produces them —
 * the `meta.driverAdapterError.cause` nesting was copied from a run against the running
 * database, not imagined. A fixture is still a fixture, so `errors.integration.spec.ts`
 * provokes the same failures for real. This file covers what that one cannot: codes no
 * table in the schema can raise yet, and the inputs that must pass through untouched.
 */

function prismaError(cause: Record<string, unknown>): unknown {
	return Object.assign(
		new Error('Invalid `prisma.location.create()` invocation in /src/server/subscriptions/repo/x.ts:41'),
		{
			code: 'P2010',
			meta: { driverAdapterError: { cause, name: 'DriverAdapterError' } },
			name: 'PrismaClientKnownRequestError',
		},
	);
}

function kindOf(error: unknown): string | undefined {
	const mapped = toDomainError(error);

	return isDomainError(mapped) ? mapped.kind : undefined;
}

describe('sqlStateOf', () => {
	it('reads the code the adapter preserved', () => {
		expect(sqlStateOf(prismaError({ kind: 'postgres', originalCode: '23P01' }))).toBe('23P01');
	});

	it('falls back to the adapter s own code field', () => {
		expect(sqlStateOf(prismaError({ code: '40001', kind: 'postgres' }))).toBe('40001');
	});

	it('is not confused by something that is not a database error', () => {
		expect(sqlStateOf(new Error('socket hang up'))).toBeUndefined();
		expect(sqlStateOf('a string')).toBeUndefined();
		expect(sqlStateOf(undefined)).toBeUndefined();
		// Prisma's own P-codes live one level up and are not SQLSTATEs.
		expect(sqlStateOf({ code: 'P2002' })).toBeUndefined();
	});
});

describe('toDomainError', () => {
	it.each([
		{ kind: 'conflict', name: 'exclusion_violation', sqlState: '23P01' },
		{ kind: 'duplicate', name: 'unique_violation', sqlState: '23505' },
		{ kind: 'validation', name: 'check_violation', sqlState: '23514' },
	])('maps $sqlState ($name) to a $kind', ({ kind, sqlState }) => {
		expect(kindOf(prismaError({ kind: 'postgres', originalCode: sqlState }))).toBe(kind);
	});

	it('carries the constraint that refused, when the adapter named it', () => {
		const mapped = toDomainError(
			prismaError({
				constraint: { index: 'locations_organization_id_name_key' },
				kind: 'UniqueConstraintViolation',
				originalCode: '23505',
			}),
		);

		expect(isDomainError(mapped) && mapped.constraint).toBe('locations_organization_id_name_key');
	});

	it('does not leak the Prisma message, which contains the source of the failing call', () => {
		const mapped = toDomainError(prismaError({ kind: 'postgres', originalCode: '23505' }));

		expect(isDomainError(mapped) && mapped.message).not.toContain('invocation');
	});

	it.each([
		['23503', 'a foreign key violation is a bug or a race, not something a user typed'],
		['42501', 'a refused table is a missing grant, never a business outcome'],
		['40001', 'a serialization failure is for a retry to handle'],
	])('leaves %s alone, because %s', (sqlState) => {
		const error = prismaError({ kind: 'postgres', originalCode: sqlState });

		expect(toDomainError(error)).toBe(error);
	});

	it.each([
		['a plain error', new Error('socket hang up')],
		['a string', 'something threw a string'],
		['nothing at all', undefined],
	])('returns %s unchanged', (_, error) => {
		expect(toDomainError(error)).toBe(error);
	});

	it('leaves a domain error alone rather than wrapping it twice', () => {
		const already = new DomainError('conflict');

		expect(toDomainError(already)).toBe(already);
	});
});
