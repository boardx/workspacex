-- A source-definition fingerprint distinguishes metadata-only package revisions.
-- Existing v1 ledgers retain their original package digest and NULL fingerprint.
ALTER TABLE starter_pack_imports ADD COLUMN IF NOT EXISTS source_definition_digest text
  CHECK(source_definition_digest IS NULL OR source_definition_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE agent_starter_pack_imports ADD COLUMN IF NOT EXISTS source_definition_digest text
  CHECK(source_definition_digest IS NULL OR source_definition_digest ~ '^[a-f0-9]{64}$');

ALTER TABLE starter_pack_imports ADD COLUMN IF NOT EXISTS metadata_only boolean NOT NULL DEFAULT false;
ALTER TABLE agent_starter_pack_imports ADD COLUMN IF NOT EXISTS metadata_only boolean NOT NULL DEFAULT false;

-- A single verified legacy execution-hash preimage per immutable version. JSONB
-- object order and unordered file rows cannot reconstruct every historical hash.
CREATE TABLE IF NOT EXISTS skill_execution_representations (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id text NOT NULL,
  representation text NOT NULL,
  PRIMARY KEY(org_id,version_id),
  FOREIGN KEY(version_id,org_id) REFERENCES skill_versions(id,org_id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION verify_skill_execution_representation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM skill_versions WHERE org_id=NEW.org_id AND id=NEW.version_id
    AND content_digest=encode(sha256(convert_to(NEW.representation,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'skill execution representation does not match immutable version';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS skill_execution_representation_matches ON skill_execution_representations;
CREATE TRIGGER skill_execution_representation_matches BEFORE INSERT ON skill_execution_representations
FOR EACH ROW EXECUTE FUNCTION verify_skill_execution_representation();
ALTER TABLE skill_execution_representations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_execution_representations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_execution_representations_tenant ON skill_execution_representations;
CREATE POLICY skill_execution_representations_tenant ON skill_execution_representations
  USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON skill_execution_representations FROM app_rw;
GRANT SELECT,INSERT ON skill_execution_representations TO app_rw;
SELECT kernel_apply_org_freeze_policies();
