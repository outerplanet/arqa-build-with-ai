import { DomainError, type DomainErrorKind, isDomainError } from '@server/kernel/errors';
import 'server-only';

/**
 * Turns a database failure into something the interface can act on.
 *
 * The application never presents a raw database error. A Prisma error message is not
 * user-safe in the literal sense: it embeds the failing call, the source file's absolute
 * path and a snippet of the surrounding code, all of which would be shipped to a browser
 * by an unlucky `error.message` in a Server Action.
 *
 * Where the SQLSTATE actually is, verified against Prisma 7 with the pg driver adapter
 * rather than assumed:
 *
 *     error.meta.driverAdapterError.cause.originalCode   // "23505", "23P01", "42501"
 *     error.meta.driverAdapterError.cause.constraint.index // when Prisma recognised the kind
 *
 * That path holds for every failure observed, including the ones Prisma gives a `P` code
 * of its own — a unique violation arrives as `P2002` and still carries `23505` underneath.
 * Reading the SQLSTATE rather than the `P` code keeps one table instead of two, and keeps
 * it in the vocabulary the migrations are written in.
 */
const KIND_BY_SQLSTATE: Record<string, DomainErrorKind> = {
	/** exclusion_violation — two rows claiming the same resource over the same range */
	'23P01': 'conflict',
	/** unique_violation */
	'23505': 'duplicate',
	/** check_violation */
	'23514': 'validation',
};

/*
 * Deliberately unmapped, and the list is short on purpose:
 *
 *   - `23503` foreign_key_violation. It reads like a validation error and usually is not:
 *     the application resolved an id that no longer exists, which is a bug or a race, and
 *     it should surface as one rather than as "please check your input".
 *   - `42501` insufficient_privilege. The application role was refused a table. That is a
 *     migration or a grant that is wrong, never something a user did.
 *
 * Anything absent from the table is returned untouched, so an unexpected failure stays
 * unexpected instead of being dressed as a business outcome.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function adapterCause(error: unknown): Record<string, unknown> | undefined {
	return asRecord(asRecord(asRecord(asRecord(error)?.meta)?.driverAdapterError)?.cause);
}

/** The five-character SQLSTATE the database raised, if this is a database error at all. */
export function sqlStateOf(error: unknown): string | undefined {
	const cause = adapterCause(error);
	const code = cause?.originalCode ?? cause?.code;

	return typeof code === 'string' ? code : undefined;
}

/**
 * The constraint that refused.
 *
 * Present when the adapter recognised the failure — a unique violation names its index.
 * A real exclusion violation is expected to name its constraint the same way, but there is
 * no exclusion constraint in the schema yet, so that half is unverified until one exists.
 */
function constraintOf(error: unknown): string | undefined {
	const index = asRecord(adapterCause(error)?.constraint)?.index;

	return typeof index === 'string' ? index : undefined;
}

export function toDomainError(error: unknown): unknown {
	if (isDomainError(error)) {
		return error;
	}

	const sqlState = sqlStateOf(error);
	const kind = sqlState === undefined ? undefined : KIND_BY_SQLSTATE[sqlState];

	if (kind === undefined) {
		return error;
	}

	return new DomainError(kind, { cause: error, constraint: constraintOf(error) });
}
