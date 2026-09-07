CREATE TABLE IF NOT EXISTS native_output_staging (
 id uuid PRIMARY KEY,
 org_id text NOT NULL,
 run_id text NOT NULL,
 idempotency_key text NOT NULL,
 args_digest text NOT NULL,
 sha256 text NOT NULL,
 file jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,run_id,idempotency_key),
 FOREIGN KEY(run_id,org_id) REFERENCES agent_runs(id,org_id) ON DELETE CASCADE
);
ALTER TABLE native_output_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_output_staging FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON native_output_staging;
CREATE POLICY tenant_isolation ON native_output_staging USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON native_output_staging TO app_rw;
SELECT kernel_apply_org_freeze_policies();
