-- Durable FIFO delivery. A delivery remains visible until the kernel observes its
-- stable message id in checkpoint state; a lost HTTP response must not lose input.
CREATE TABLE IF NOT EXISTS agent_run_interjections (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  interjection_id text NOT NULL,
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  received_at timestamptz NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  classification text CHECK (classification IN ('adjustment', 'direction_change')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'staged', 'applied')),
  applied_at timestamptz,
  PRIMARY KEY (org_id, run_id, interjection_id)
);
CREATE INDEX IF NOT EXISTS agent_run_interjections_pending ON agent_run_interjections(org_id, run_id, sequence)
  WHERE status <> 'applied';
ALTER TABLE agent_run_interjections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_interjections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_interjections_tenant ON agent_run_interjections;
CREATE POLICY agent_run_interjections_tenant ON agent_run_interjections
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON agent_run_interjections TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE agent_run_interjections_sequence_seq TO app_rw;
SELECT kernel_apply_org_freeze_policies();

-- The request is separate from paused_at: queued intent is not a confirmed pause.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pause_requested_at timestamptz;
