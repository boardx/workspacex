-- Enterprise generation is stored only in organization_plans (capacity migration).
-- Financial history intentionally outlives an organization, like wallet/ledger records.
-- Live writers establish existence under the epoch -> organization row lock.
CREATE TABLE IF NOT EXISTS enterprise_credit_grants (
 id text PRIMARY KEY, org_id text NOT NULL, generation text NOT NULL,
 idempotency_key text NOT NULL, actor_id text NOT NULL,
 credits integer NOT NULL CHECK(credits BETWEEN 1 AND 1000000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 audit_ref text NOT NULL UNIQUE, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,idempotency_key)
);
ALTER TABLE enterprise_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_credit_grants FORCE ROW LEVEL SECURITY;
DO $policy$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='enterprise_credit_grants'::regclass AND polname='tenant_scope') THEN
  CREATE POLICY tenant_scope ON enterprise_credit_grants
   USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
 END IF;
END;
$policy$;
REVOKE ALL ON enterprise_credit_grants FROM app_rw;
GRANT SELECT,INSERT ON enterprise_credit_grants TO app_rw;
DO $trigger$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='enterprise_credit_grants'::regclass AND tgname='enterprise_credit_grants_append_only') THEN
  CREATE TRIGGER enterprise_credit_grants_append_only BEFORE UPDATE OR DELETE ON enterprise_credit_grants
   FOR EACH ROW EXECUTE FUNCTION platform_org_access_append_only();
 END IF;
END;
$trigger$;
SELECT kernel_apply_org_freeze_policies();
CREATE TABLE IF NOT EXISTS enterprise_upgrade_operations (
 org_id text NOT NULL, operation_ref text NOT NULL,
 actor_id text NOT NULL, idempotency_key text NOT NULL, expected_version integer NOT NULL,
 generation text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(org_id,operation_ref), UNIQUE(org_id,idempotency_key)
);
ALTER TABLE enterprise_upgrade_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_upgrade_operations FORCE ROW LEVEL SECURITY;
DO $policy$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='enterprise_upgrade_operations'::regclass AND polname='tenant_scope') THEN
  CREATE POLICY tenant_scope ON enterprise_upgrade_operations
   USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
 END IF;
END;
$policy$;
REVOKE ALL ON enterprise_upgrade_operations FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON enterprise_upgrade_operations TO app_rw;
SELECT kernel_apply_org_freeze_policies();
