-- Capability-specific approved resource snapshots; no second run/attempt/approval state machine.
CREATE TABLE IF NOT EXISTS mcp_review_snapshots (
 org_id text NOT NULL,
 review_id uuid NOT NULL,
 server_id text NOT NULL,
 reviewer_id text NOT NULL,
 endpoint text NOT NULL,
 record jsonb NOT NULL,
 tools jsonb NOT NULL CHECK(jsonb_typeof(tools)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,review_id),
 FOREIGN KEY(org_id,server_id) REFERENCES mcp_servers(org_id,server_id) ON DELETE CASCADE
);
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS current_review_id uuid NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mcp_servers_current_review_fk') THEN
  ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_current_review_fk FOREIGN KEY(org_id,current_review_id)
   REFERENCES mcp_review_snapshots(org_id,review_id) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS mcp_run_snapshots (
 org_id text NOT NULL,
 run_id text NOT NULL,
 snapshot_id uuid NOT NULL,
 agent_id text NOT NULL,
 agent_version_id text NOT NULL,
 requester_id text NOT NULL,
 agent_observed_updated_at timestamptz NOT NULL,
 tools jsonb NOT NULL CHECK(jsonb_typeof(tools)='array'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,run_id),
 UNIQUE(org_id,snapshot_id),
 FOREIGN KEY(run_id,org_id) REFERENCES agent_runs(id,org_id) ON DELETE CASCADE
);
ALTER TABLE mcp_review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_review_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mcp_review_snapshots;
CREATE POLICY tenant_isolation ON mcp_review_snapshots USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
ALTER TABLE mcp_run_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_run_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mcp_run_snapshots;
CREATE POLICY tenant_isolation ON mcp_run_snapshots USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON mcp_review_snapshots,mcp_run_snapshots TO app_rw;
REVOKE UPDATE,DELETE ON mcp_review_snapshots,mcp_run_snapshots FROM app_rw;
SELECT kernel_apply_org_freeze_policies();
-- A call is claimed before network dispatch. Pending/unconfirmed calls are never replayed as a new side effect.
CREATE TABLE IF NOT EXISTS mcp_tool_executions (
 org_id text NOT NULL,run_id text NOT NULL,tool_call_id text NOT NULL,
 tool_name text NOT NULL,args_digest text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','succeeded','unconfirmed')),
 result jsonb NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,run_id,tool_call_id),
 FOREIGN KEY(run_id,org_id) REFERENCES agent_runs(id,org_id) ON DELETE CASCADE
);
ALTER TABLE mcp_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mcp_tool_executions;
CREATE POLICY tenant_isolation ON mcp_tool_executions USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON mcp_tool_executions TO app_rw;
SELECT kernel_apply_org_freeze_policies();
