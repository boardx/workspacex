-- Durable request starts are not usage totals. Unsettled starts expose coverage gaps.
CREATE TABLE IF NOT EXISTS model_request_starts (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL, run_id text NOT NULL, execution_attempt_id text NULL,
 project_id text NULL, model_provider text NOT NULL, model_id text NOT NULL,
 started_at timestamptz NOT NULL
);
ALTER TABLE model_request_starts ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_request_starts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON model_request_starts;
CREATE POLICY tenant_scope ON model_request_starts
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON model_request_starts TO app_rw;
DROP TRIGGER IF EXISTS model_request_starts_append_only ON model_request_starts;
CREATE TRIGGER model_request_starts_append_only BEFORE UPDATE OR DELETE ON model_request_starts
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS request_started_at timestamptz NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS request_ended_at timestamptz NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS execution_attempt_id text NULL;
SELECT kernel_apply_org_freeze_policies();
