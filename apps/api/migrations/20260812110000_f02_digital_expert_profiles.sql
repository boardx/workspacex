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

-- Upgrading must not make the existing Agent directory disappear.  The marker is
-- intentionally not inferred from role/duty prose: owners can classify it later, while
-- the unfiltered expert catalogue remains complete and honest in the meantime.
INSERT INTO digital_expert_profiles (org_id, agent_id, domains)
SELECT c.org_id, c.id, ARRAY['未分类']::text[]
  FROM capability_listings c
  JOIN agents a ON a.org_id = c.org_id AND a.id = c.id
 WHERE c.kind = 'agent'
ON CONFLICT (org_id, agent_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_digital_expert_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'agent' THEN
    INSERT INTO digital_expert_profiles (org_id, agent_id, domains)
    VALUES (NEW.org_id, NEW.id, ARRAY['未分类']::text[])
    ON CONFLICT (org_id, agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS capability_listing_ensures_digital_expert_profile_trg
  ON capability_listings;
CREATE TRIGGER capability_listing_ensures_digital_expert_profile_trg
  AFTER INSERT OR UPDATE OF kind ON capability_listings
  FOR EACH ROW EXECUTE FUNCTION ensure_digital_expert_profile();

ALTER TABLE digital_expert_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_expert_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digital_expert_profiles_tenant ON digital_expert_profiles;
CREATE POLICY digital_expert_profiles_tenant ON digital_expert_profiles
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON digital_expert_profiles FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON digital_expert_profiles TO app_rw;
SELECT kernel_apply_org_freeze_policies();
