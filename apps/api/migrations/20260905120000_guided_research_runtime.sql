-- #2775 Durable messages, research effects and reports, with per-session command fencing.
CREATE TABLE guided_research_runtime (
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
CREATE POLICY guided_research_runtime_tenant ON guided_research_runtime
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON guided_research_runtime TO app_rw;
SELECT kernel_apply_org_freeze_policies();
