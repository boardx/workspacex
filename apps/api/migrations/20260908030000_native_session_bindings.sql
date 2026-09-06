CREATE TABLE IF NOT EXISTS native_session_bindings (
 id uuid PRIMARY KEY,
 org_id text NOT NULL,
 run_id text NOT NULL,
 status text NOT NULL CHECK(status IN('provisioning','ready','failed','release_pending','released')),
 session_id uuid,
 token_cipher text,
 expires_at bigint,
 package_digest text NOT NULL,
 interrupt_on jsonb NOT NULL,
 UNIQUE(org_id,run_id), FOREIGN KEY(run_id,org_id) REFERENCES agent_runs(id,org_id) ON DELETE CASCADE,
 CHECK(status<>'ready' OR (session_id IS NOT NULL AND token_cipher IS NOT NULL AND expires_at IS NOT NULL))
);
ALTER TABLE native_session_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_session_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON native_session_bindings;
CREATE POLICY tenant_isolation ON native_session_bindings USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON native_session_bindings TO app_rw;

SELECT kernel_apply_org_freeze_policies();

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS remote_thread_id text;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS runtime_profile text NOT NULL DEFAULT 'legacy' CHECK(runtime_profile IN ('legacy','native-v1'));
