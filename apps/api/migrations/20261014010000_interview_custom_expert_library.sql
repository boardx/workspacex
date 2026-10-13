-- Personal reusable simulated profiles; these never create Agent or user identities.
CREATE TABLE IF NOT EXISTS interview_custom_expert_profiles (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES credentials(user_id) ON DELETE CASCADE,
 expert_id text NOT NULL CHECK (expert_id LIKE 'custom-expert-%'),
 request_id uuid NOT NULL,
 fields jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,actor_id,expert_id),
 UNIQUE(org_id,actor_id,request_id)
);
ALTER TABLE interview_custom_expert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_custom_expert_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_custom_expert_profiles_tenant ON interview_custom_expert_profiles;
CREATE POLICY interview_custom_expert_profiles_tenant ON interview_custom_expert_profiles
 USING(org_id=current_setting('app.current_org',true))
 WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON interview_custom_expert_profiles TO app_rw;
SELECT kernel_apply_org_freeze_policies();
