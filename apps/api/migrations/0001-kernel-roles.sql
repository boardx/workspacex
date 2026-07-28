-- 0001 kernel roles
--
-- Two identities, deliberately separate (see infrastructure/db/pg-config.ts):
--   * the migration role owns the tables and runs DDL
--   * app_rw is the runtime identity: NOT an owner, no BYPASSRLS, no DDL
--
-- In PostgreSQL a table owner bypasses RLS by default. Running the application as the
-- owner means RLS is written but not in effect, and everything looks fine on the surface.
-- That is the number one cause of "we thought RLS was on".
--
-- Every statement here must be replayable: migrate:check replays each file ignoring the
-- version table, precisely so that "runs twice" is a real assertion and not a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_dev';
  END IF;
END
$$;

-- Explicit, not inherited: a future superuser-ish default must not silently grant this.
ALTER ROLE app_rw NOBYPASSRLS;
ALTER ROLE app_rw NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Usage only. CREATE is withheld on purpose: the application must not be able to run DDL.
REVOKE ALL ON SCHEMA public FROM app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;

-- The health probe reads its own migration version.
GRANT SELECT ON _kernel_migrations TO app_rw;
