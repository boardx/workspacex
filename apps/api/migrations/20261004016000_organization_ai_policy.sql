-- Empty, inactive configuration storage; no existing budget, plan or kind is changed.
CREATE TABLE IF NOT EXISTS organization_ai_policies (
 org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0), configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 price_version text NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_ai_policy_changes (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0), configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 price_version text NOT NULL, actor_id text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 changed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organization_ai_policies','organization_ai_policy_changes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(org_id=current_setting(''app.current_org'',true)) WITH CHECK(org_id=current_setting(''app.current_org'',true))',t);
 END LOOP;
END $$;
REVOKE ALL ON organization_ai_policies,organization_ai_policy_changes FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON organization_ai_policies TO app_rw;
GRANT SELECT,INSERT ON organization_ai_policy_changes TO app_rw;
-- Only the trusted member/template resolver can create windows; existing rows are immutable.
GRANT INSERT ON ai_budget_windows TO app_rw;
DROP TRIGGER IF EXISTS ai_budget_windows_append_only ON ai_budget_windows;
CREATE TRIGGER ai_budget_windows_append_only BEFORE UPDATE OR DELETE ON ai_budget_windows
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
DROP TRIGGER IF EXISTS ai_policy_changes_append_only ON organization_ai_policy_changes;
CREATE TRIGGER ai_policy_changes_append_only BEFORE UPDATE OR DELETE ON organization_ai_policy_changes
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
SELECT kernel_apply_org_freeze_policies();
