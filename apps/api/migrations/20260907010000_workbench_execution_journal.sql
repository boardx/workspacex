ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS checkpoint_resume boolean NOT NULL DEFAULT false;
-- Public execution activity, ordered across text and tool events. Run ownership is
-- checked before replay and tenant isolation is enforced independently by RLS.
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_org_id_id_journal_idx ON agent_runs(org_id,id);
CREATE TABLE IF NOT EXISTS agent_execution_events (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  seq integer NOT NULL CHECK (seq >= 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, run_id, seq),
  FOREIGN KEY (org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE CASCADE
);
ALTER TABLE agent_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_execution_events_tenant ON agent_execution_events;
CREATE POLICY agent_execution_events_tenant ON agent_execution_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON agent_execution_events FROM app_rw;
GRANT SELECT, INSERT ON agent_execution_events TO app_rw;
SELECT kernel_apply_org_freeze_policies();
