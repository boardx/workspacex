-- WX-T042: durable existing subtask queue; no additional execution state machine.
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_id_org_subtask_uniq ON agent_runs(id, org_id);
CREATE TABLE IF NOT EXISTS subtask_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_run_id text NOT NULL,
  description text NOT NULL,
  idempotency_key text,
  context text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  result text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (parent_run_id, org_id) REFERENCES agent_runs(id, org_id) ON DELETE CASCADE,
  CHECK ((status IN ('pending','running') AND result IS NULL AND error IS NULL)
    OR (status='completed' AND result IS NOT NULL AND error IS NULL)
    OR (status='failed' AND result IS NULL AND error IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS subtask_runs_idempotency_idx ON subtask_runs(org_id,parent_run_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS subtask_runs_pending_idx ON subtask_runs(org_id, created_at, id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS subtask_runs_parent_idx ON subtask_runs(org_id, parent_run_id, created_at, id);
ALTER TABLE subtask_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtask_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subtask_runs_tenant ON subtask_runs;
CREATE POLICY subtask_runs_tenant ON subtask_runs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON subtask_runs TO app_rw;
SELECT kernel_apply_org_freeze_policies();
