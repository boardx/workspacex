-- #2775 Durable messages, research effects and reports, with per-session command fencing.
--
-- UC-0.6 V6 (migrate:check) replays every migration file with `force: true` against the
-- schema it just built, ignoring the version table -- CREATE TABLE/POLICY must tolerate
-- running twice, same as every other migration in this directory (see e.g.
-- 20260812110000_f168_guided_research_sessions.sql's `CREATE TABLE IF NOT EXISTS`, or the
-- `DROP POLICY IF EXISTS` + `CREATE POLICY` pair used throughout for RLS policies).
CREATE TABLE IF NOT EXISTS guided_research_runtime (
  session_id text NOT NULL,
  org_id text NOT NULL,
  state jsonb NOT NULL,
  active_request_id text,
  requests jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (org_id, session_id),
  FOREIGN KEY (session_id, org_id) REFERENCES guided_research_sessions(id, org_id) ON DELETE CASCADE
);
ALTER TABLE guided_research_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE guided_research_runtime FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guided_research_runtime_tenant ON guided_research_runtime;
CREATE POLICY guided_research_runtime_tenant ON guided_research_runtime
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON guided_research_runtime TO app_rw;
SELECT kernel_apply_org_freeze_policies();
