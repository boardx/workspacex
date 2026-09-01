-- `error_logs` -- a queryable home for `AllExceptionsFilter`'s "unhandled exception" bucket
-- (see `application/ports/error-log.port.ts` for the full design rationale). Written to
-- alongside, not instead of, the existing structured console log.
--
-- ⚠ Deliberately NO `org_id`. This is infrastructure self-observation, not tenant business
--   data (same class as `_kernel_migrations`) -- many of the errors it records happen before
--   any tenant context exists at all (e.g. a login attempt that never got as far as resolving
--   an organization). `lint-permission-paths.mjs` classifies "tenant table" by presence of an
--   `org_id` column (or a transitive reference to one); a table with none is correctly outside
--   its scope, and this one must stay that way -- adding `org_id` later would misrepresent
--   these rows as belonging to whichever tenant happened to be in context, when most of them
--   don't.
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL,
  msg TEXT NOT NULL,
  -- Same shape `ConsoleLogger` derives: {name, message, stack} for an Error, {raw} otherwise.
  detail JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lookup this table exists for: "give me the detail for this traceId".
CREATE INDEX IF NOT EXISTS error_logs_trace_id_idx ON error_logs (trace_id);

-- Retention housekeeping reads/deletes by age (`PgErrorLogWriter`'s opportunistic cleanup).
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at);

-- Least privilege for the runtime role (2026-09-01 independent review finding #1), AND the
-- reason `PgErrorLogWriter` could not write a single row without this: `0001-kernel-roles.sql`
-- revokes ALL schema-level privileges from `app_rw` up front and grants nothing back by
-- default -- every table needs its own explicit GRANT (see `0002-rls-probe.sql`,
-- `20260812110000_f02_digital_expert_profiles.sql` for the established pattern) or `app_rw`
-- can touch it not at all. This file had no GRANT until this line, which is not a narrower
-- privilege than intended -- it is a table `app_rw` could not reach yet, caught by
-- `pg-error-log-writer-real-postgres.test.ts` failing outright with
-- `permission denied for table error_logs` (42501) the moment CI ran it against a real
-- database with roles actually enforced.
--
-- What `app_rw` (the identity `PgErrorLogWriter` runs as, see `pg-config.ts`) actually needs:
-- `INSERT` (every `record()` call) and `DELETE` (`sweepExpiredErrorLogs`'s retention sweep).
-- It needs neither `SELECT` nor `UPDATE` -- nothing in this codebase ever reads this table
-- back through the app role, by the explicit scope decision in `pg-error-log-writer.ts`'s
-- header ("a Postgres table + direct SQL by whoever already has deploy-machine DB
-- credentials", not a new HTTP surface or a new role). Withholding `SELECT` here is what
-- makes that decision mechanical rather than a comment: the review's finding #1 was that "the
-- application DB role... can query this global table" -- after this line it structurally
-- cannot. Reading `error_logs` still requires connecting with credentials other than the ones
-- the running API process holds (the migration/owner role in this repo's model), which is the
-- boundary already documented and is not widened by this change.
REVOKE ALL ON error_logs FROM app_rw;
GRANT INSERT, DELETE ON error_logs TO app_rw;
-- INSERT into a BIGSERIAL PK needs the sequence's nextval(), not SELECT on the sequence.
GRANT USAGE ON SEQUENCE error_logs_id_seq TO app_rw;

-- `kernel_tenant_table_audit` (0004) classifies this table `UNTENANTED_BUT_GRANTED` without
-- the line below: it has no `org_id` (by design, see this file's header) AND `app_rw` holds
-- grants on it (INSERT/DELETE above) -- exactly the shape of "a table with nothing to filter
-- on that the runtime role can reach", which is a real cross-tenant hole for any table that
-- actually needs one. `error_logs` does not: it is infrastructure self-observation in the
-- same class as `_kernel_migrations` (that table's own exemption comment says so, and 0004's
-- header explains why the exemption must be a declared table COMMENT rather than an allowlist
-- entry someone edits at the moment they are trying to make the gate green). The audit does
-- not distinguish "has grants because it needs SELECT" from "has grants because it needs only
-- INSERT/DELETE" -- both are, from a tenant-isolation standpoint, "the runtime role can reach
-- an untenanted table", which is what this comment is attesting is intentional here.
COMMENT ON TABLE error_logs IS
  'kernel-no-tenant-data: unhandled-exception diagnostic log, deliberately has no org_id (many '
  'of the errors it records happen before any tenant context exists, e.g. a failed login). '
  'app_rw holds INSERT/DELETE only (no SELECT/UPDATE) -- see the GRANT block above and '
  'pg-error-log-writer.ts''s header for the read-access boundary this does and does not widen.';
