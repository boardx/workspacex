-- Phase 04 F02: an Agent's responsibility prose and published Agent version are not
-- expert taxonomy or source material. This projection stores those two interview-specific
-- facts explicitly, while the Agent remains the single organization-level identity.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'context_packs_run_org_uniq'
  ) THEN
    ALTER TABLE context_packs
      ADD CONSTRAINT context_packs_run_org_uniq UNIQUE (run_id, org_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS digital_expert_profiles (
  org_id                    text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id                  text NOT NULL,
  domains                   text[] NOT NULL CHECK (cardinality(domains) > 0),
  material_context_pack_id  text,
  material_version          text,
  PRIMARY KEY (org_id, agent_id),
  CONSTRAINT digital_expert_profiles_agent_fk
    FOREIGN KEY (agent_id, org_id) REFERENCES agents(id, org_id) ON DELETE CASCADE,
  CONSTRAINT digital_expert_profiles_material_pair
    CHECK ((material_context_pack_id IS NULL) = (material_version IS NULL)),
  CONSTRAINT digital_expert_profiles_pack_fk
    FOREIGN KEY (material_context_pack_id, org_id)
    REFERENCES context_packs(run_id, org_id)
);

ALTER TABLE digital_expert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_expert_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digital_expert_profiles_tenant ON digital_expert_profiles;
CREATE POLICY digital_expert_profiles_tenant ON digital_expert_profiles
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON digital_expert_profiles FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON digital_expert_profiles TO app_rw;
SELECT kernel_apply_org_freeze_policies();

