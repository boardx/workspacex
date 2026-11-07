CREATE TABLE IF NOT EXISTS credit_native_tariff_changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id text NOT NULL,actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 old_tariff jsonb,new_tariff jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE credit_native_tariff_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_native_tariff_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON credit_native_tariff_changes;
CREATE POLICY tenant_scope ON credit_native_tariff_changes USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON credit_native_tariff_changes TO app_rw;
DROP TRIGGER IF EXISTS immutable_credit_native_tariff_changes ON credit_native_tariff_changes;
CREATE TRIGGER immutable_credit_native_tariff_changes BEFORE UPDATE OR DELETE ON credit_native_tariff_changes FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
