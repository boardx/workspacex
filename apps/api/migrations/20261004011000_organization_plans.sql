-- Additive plan storage. Missing rows remain unconfigured; no existing kind/quota is changed.
CREATE TABLE IF NOT EXISTS organization_plans (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('ordinary','enterprise')),
  version integer NOT NULL CHECK (version > 0), updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_plan_changes (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version > 0), previous_plan text NULL CHECK(previous_plan IN ('ordinary','enterprise')),
  plan text NOT NULL CHECK(plan IN ('ordinary','enterprise')), actor_id text NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,version)
);
-- Platform access audit is global, INSERT-only for app_rw. No prompt, query or member content.
CREATE TABLE IF NOT EXISTS platform_organization_access_events (
  id text PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL CHECK(action IN ('list','detail')),
  target_org_id text NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organization_plans','organization_plan_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (org_id=current_setting(''app.current_org'',true)) WITH CHECK (org_id=current_setting(''app.current_org'',true))',t);
  END LOOP;
END $$;
REVOKE ALL ON organization_plans,organization_plan_changes,platform_organization_access_events FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON organization_plans TO app_rw;
GRANT SELECT,INSERT ON organization_plan_changes TO app_rw;
GRANT INSERT ON platform_organization_access_events TO app_rw;
DROP TRIGGER IF EXISTS plan_changes_append_only ON organization_plan_changes;
CREATE TRIGGER plan_changes_append_only BEFORE UPDATE OR DELETE ON organization_plan_changes
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
CREATE OR REPLACE FUNCTION platform_org_access_append_only() RETURNS trigger AS $$ BEGIN
 RAISE EXCEPTION 'platform organization access audit is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS platform_org_access_append_only ON platform_organization_access_events;
CREATE TRIGGER platform_org_access_append_only BEFORE UPDATE OR DELETE ON platform_organization_access_events
 FOR EACH ROW EXECUTE FUNCTION platform_org_access_append_only();
SELECT kernel_apply_org_freeze_policies();
