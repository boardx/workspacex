-- Server-scoped MCP transport cancellation; never changes the parent run lifecycle.
CREATE TABLE IF NOT EXISTS mcp_isolation_requests (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 server_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('interrupt','drain')),
 requested_by text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>0),
 affected_agent_ids jsonb NOT NULL CHECK(jsonb_typeof(affected_agent_ids)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,request_id),
 FOREIGN KEY(org_id,server_id) REFERENCES mcp_servers(org_id,server_id) ON DELETE CASCADE
);
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS isolation_mode text NULL CHECK(isolation_mode IN ('interrupt','drain'));
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS server_id text NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS review_id uuid NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS attempt_id text NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS lease_epoch integer NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS deadline_at timestamptz NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS isolation_request_id uuid NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS local_stop_ack_at timestamptz NULL;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mcp_execution_isolation_request_fk') THEN
  ALTER TABLE mcp_tool_executions ADD CONSTRAINT mcp_execution_isolation_request_fk
   FOREIGN KEY(org_id,isolation_request_id) REFERENCES mcp_isolation_requests(org_id,request_id);
 END IF;
END $$;
-- Historical pending rows have no proven live transport lease: status queries reclaim them as unknown.
CREATE INDEX IF NOT EXISTS mcp_executions_server_pending ON mcp_tool_executions(org_id,server_id) WHERE status='pending';
ALTER TABLE mcp_isolation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_isolation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mcp_isolation_requests;
CREATE POLICY tenant_isolation ON mcp_isolation_requests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON mcp_isolation_requests TO app_rw;
REVOKE UPDATE,DELETE ON mcp_isolation_requests FROM app_rw;
CREATE TABLE IF NOT EXISTS mcp_isolation_calls (
 org_id text NOT NULL,
 request_id uuid NOT NULL,
 run_id text NOT NULL,
 tool_call_id text NOT NULL,
 PRIMARY KEY(org_id,request_id,run_id,tool_call_id),
 FOREIGN KEY(org_id,request_id) REFERENCES mcp_isolation_requests(org_id,request_id) ON DELETE CASCADE,
 FOREIGN KEY(org_id,run_id,tool_call_id) REFERENCES mcp_tool_executions(org_id,run_id,tool_call_id) ON DELETE CASCADE
);
ALTER TABLE mcp_isolation_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_isolation_calls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mcp_isolation_calls;
CREATE POLICY tenant_isolation ON mcp_isolation_calls USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON mcp_isolation_calls TO app_rw;
REVOKE UPDATE,DELETE ON mcp_isolation_calls FROM app_rw;
UPDATE mcp_tool_executions e SET server_id=t.value->'tool'->>'serverId',review_id=(t.value->>'reviewId')::uuid
 FROM mcp_run_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.tools) t(value)
 WHERE e.org_id=s.org_id AND e.run_id=s.run_id AND e.tool_name=t.value->'runtime'->>'name' AND e.server_id IS NULL;
SELECT kernel_apply_org_freeze_policies();
