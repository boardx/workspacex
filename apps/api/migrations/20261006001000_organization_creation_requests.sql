-- Creator-owned retry receipt, scoped to the NEW tenant.
CREATE TABLE IF NOT EXISTS organization_creation_requests (
 org_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES credentials(user_id), request_id uuid NOT NULL,
 org_name text NOT NULL CHECK(length(org_name) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
ALTER TABLE organization_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_creation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON organization_creation_requests;
CREATE POLICY tenant_scope ON organization_creation_requests
 USING (org_id=current_setting('app.current_org',true))
 WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON organization_creation_requests FROM app_rw;
GRANT SELECT,INSERT ON organization_creation_requests TO app_rw;
SELECT kernel_apply_org_freeze_policies();
