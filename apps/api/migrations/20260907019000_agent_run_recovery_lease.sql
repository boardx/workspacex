ALTER TABLE agent_runs ADD COLUMN lease_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE agent_runs ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN recovery_diagnostic text;
CREATE INDEX agent_runs_recovery_due_idx ON agent_runs(lease_expires_at) WHERE status='running';
-- Recovery discovers expired work; it must not declare failure/cancel a live remote run.
CREATE OR REPLACE FUNCTION kernel_reclaim_orphaned_agent_runs(threshold_ms integer)
RETURNS TABLE(id text,org_id text,thread_id text,remote_run_id text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT r.id,r.org_id,r.thread_id,r.remote_run_id FROM agent_runs r
  WHERE r.status='running' AND coalesce(r.lease_expires_at,
    coalesce(r.heartbeat_at,r.started_at)+(threshold_ms||' milliseconds')::interval)<now()
  ORDER BY r.started_at,r.id LIMIT 100
$$;
