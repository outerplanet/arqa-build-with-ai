#!/bin/bash
# Runs once, on first initialisation of an empty data directory, as the superuser.
# Re-running it means destroying the volume: `pnpm db:reset`.
#
# Two non-superuser roles, and the separation matters more than it looks:
#
#   app_migrator  owns the schema and runs migrations
#   app_user      connects at runtime and owns nothing
#
# The immediate payoff is that application code cannot drop a table. The larger one arrives
# if you add Row Level Security: a policy is not enforced against a table's OWNER unless the
# table also has FORCE ROW LEVEL SECURITY. If the application connected as the role that
# created the tables, every policy would be silently inert — the most dangerous failure mode
# there is, because every isolation test would pass while isolating nothing.
#
# Neither role has BYPASSRLS. Neither is a superuser, who bypasses RLS unconditionally.

set -euo pipefail

TEST_DB="${POSTGRES_DB}_test"
# Prisma resets a shadow database on every `migrate dev` to work out what changed.
# It would normally create one itself, which needs CREATEDB — a privilege the migration
# role has no business holding in production. Creating it here keeps the role narrow.
SHADOW_DB="${POSTGRES_DB}_shadow"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE ROLE "${MIGRATE_DB_USER}"
		LOGIN PASSWORD '${MIGRATE_DB_PASSWORD}'
		NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

	CREATE ROLE "${APP_DB_USER}"
		LOGIN PASSWORD '${APP_DB_PASSWORD}'
		NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

	CREATE DATABASE "${TEST_DB}" TEMPLATE template0 ENCODING 'UTF8';
	CREATE DATABASE "${SHADOW_DB}" TEMPLATE template0 ENCODING 'UTF8'
		OWNER "${MIGRATE_DB_USER}";
EOSQL

for db in "$POSTGRES_DB" "$TEST_DB" "$SHADOW_DB"; do
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
		-- Needed by an exclusion constraint that combines a scalar with a range — booking a
		-- resource over a time period, for instance — which plain gist cannot index.
		CREATE EXTENSION IF NOT EXISTS btree_gist;

		GRANT CONNECT ON DATABASE "${db}" TO "${MIGRATE_DB_USER}", "${APP_DB_USER}";

		-- The migrator owns the schema; the application only uses it.
		ALTER SCHEMA public OWNER TO "${MIGRATE_DB_USER}";
		GRANT USAGE ON SCHEMA public TO "${APP_DB_USER}";

		-- Whatever the migrator creates from now on is readable and writable by the
		-- application without a grant per table. Note this deliberately does NOT include
		-- ownership, so RLS would keep applying.
		ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATE_DB_USER}" IN SCHEMA public
			GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${APP_DB_USER}";
		ALTER DEFAULT PRIVILEGES FOR ROLE "${MIGRATE_DB_USER}" IN SCHEMA public
			GRANT USAGE, SELECT ON SEQUENCES TO "${APP_DB_USER}";
	EOSQL
done

echo "initialised: roles ${MIGRATE_DB_USER}, ${APP_DB_USER}; databases ${POSTGRES_DB}, ${TEST_DB}, ${SHADOW_DB}"
