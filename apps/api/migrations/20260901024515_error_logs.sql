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
