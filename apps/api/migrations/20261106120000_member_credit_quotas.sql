-- Spending policy only. No credits are issued and existing token policy remains separate.
-- Forced replay restores owned DDL/security without updating existing zero/custom overrides.
CREATE TABLE IF NOT EXISTS member_credit_quota (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 monthly_limit integer NOT NULL CHECK(monthly_limit >= 0),
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,user_id),
 FOREIGN KEY(org_id,user_id) REFERENCES org_memberships(org_id,user_id) ON DELETE CASCADE
);
ALTER TABLE member_credit_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_credit_quota FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_credit_quota_tenant ON member_credit_quota;
CREATE POLICY member_credit_quota_tenant ON member_credit_quota
 USING(org_id=current_setting('app.current_org',true))
 WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON member_credit_quota TO app_rw;
CREATE INDEX IF NOT EXISTS credit_consumption_member_holds ON credit_consumption_requests(org_id,user_id) WHERE state <> 'settled';

SELECT kernel_apply_org_freeze_policies();
