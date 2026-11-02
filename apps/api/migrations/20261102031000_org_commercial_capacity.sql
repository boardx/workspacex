-- Capacity is commercial intent, never a cached member count or a second plan flag.
ALTER TABLE organization_plans ADD COLUMN IF NOT EXISTS billing_generation text;
CREATE TABLE IF NOT EXISTS org_commercial_licenses (
  org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  generation text NOT NULL CHECK(length(generation)>0),
  purchased_seats bigint CHECK(purchased_seats>=5),
  pending_seats bigint CHECK(pending_seats>=5),
  pending_purchase_ref text CHECK(length(pending_purchase_ref)>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((pending_seats IS NULL) = (pending_purchase_ref IS NULL)),
  CHECK (purchased_seats IS NOT NULL OR pending_seats IS NOT NULL)
);
ALTER TABLE org_commercial_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_commercial_licenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON org_commercial_licenses;
CREATE POLICY tenant_scope ON org_commercial_licenses
 USING (org_id=current_setting('app.current_org',true))
 WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON org_commercial_licenses FROM app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON org_commercial_licenses TO app_rw;
-- Restrictive AND policy: the permissive tenant policy must not OR away paid protection.
DROP POLICY IF EXISTS pending_intent_deletion ON org_commercial_licenses;
CREATE POLICY pending_intent_deletion ON org_commercial_licenses AS RESTRICTIVE
 FOR DELETE USING (purchased_seats IS NULL);
COMMENT ON TABLE org_commercial_licenses IS 'All writers first lock organizations row FOR UPDATE in the same transaction. Purchased capacity survives term expiry; pending initial purchases constrain admission, quotes never write here. Enterprise derives only from organization_plans and billing_generation.';
SELECT kernel_apply_org_freeze_policies();
