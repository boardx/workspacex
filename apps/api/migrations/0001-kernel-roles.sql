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

-- Roles are CLUSTER-wide, not per-database. Two databases migrating at the same time
-- (parallel workers, each with its own WORKSPACEX_DB) both touch this one role, and
-- PostgreSQL answers the loser with `tuple concurrently updated` -- a migration failure
-- whose message says nothing about the actual cause.
--
-- ⚠ The first attempted fix was `pg_advisory_xact_lock`, and it did NOT work:
--    PostgreSQL advisory locks are scoped to the DATABASE. Three workers on three
--    databases take three independent locks and serialise nothing. The fix looked
--    correct, the comment explaining it read well, and the failure was unchanged --
--    only re-running the parallel probe showed it.
--
-- What actually works: never mutate the role unless it needs mutating. CREATE ROLE sets
-- every attribute in ONE catalog write, and the ALTER below only fires if something has
-- drifted. On the normal path (role already correct) concurrent runs do zero writes and
-- cannot conflict. The genuine first-run race is handled by a retry in the migrator.
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    INTO r FROM pg_roles WHERE rolname = 'app_rw';

  IF NOT FOUND THEN
    -- Every attribute in a single statement: one catalog write, not five.
    CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSIF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls THEN
    -- Only when it has drifted. This is the line that matters most in the whole file:
    -- BYPASSRLS on the application role means RLS is written but not in effect, and
    -- everything looks normal.
    ALTER ROLE app_rw NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Usage only. CREATE is withheld on purpose: the application must not be able to run DDL.
REVOKE ALL ON SCHEMA public FROM app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;

-- The health probe reads its own migration version.
GRANT SELECT ON _kernel_migrations TO app_rw;
