import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Fail once, clearly, instead of once per test file with a connection error that says
 * nothing about what to do next.
 */
function redact(connectionString: string): string {
	return connectionString.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

export async function setup() {
	const connectionString = process.env.DATABASE_URL;
	const migrateUrl = process.env.MIGRATE_DATABASE_URL;

	if (!connectionString || !migrateUrl) {
		throw new Error('DATABASE_URL and MIGRATE_DATABASE_URL must be set. Copy .env.example to .env, then: pnpm db:up');
	}

	// Both point at the same database through different roles. Getting this wrong means
	// migrating one database and testing another, which presents as "the table does not exist".
	if (!connectionString.includes('_test') || !migrateUrl.includes('_test')) {
		throw new Error(
			`Refusing to run integration tests against ${redact(connectionString)}.\n` +
				'They create and drop data. Both URLs must name a database containing "_test" — see .env.test.',
		);
	}

	const client = new Client({ connectionString });

	try {
		await client.connect();
		await client.end();
	} catch (cause) {
		throw new Error(
			`Cannot reach the test database at ${redact(connectionString)}.\n` +
				'Start it with: pnpm db:up   (and check that Docker Desktop is running)',
			{ cause },
		);
	}

	// dotenv does not overwrite what is already set, and prisma.config.ts loads .env — so
	// passing the test URL through the environment is what keeps the CLI off the
	// development database.
	execSync('npx prisma migrate deploy', {
		env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
		stdio: 'pipe',
	});
}
