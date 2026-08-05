-- Wave 2 #417: durable Agent definitions, immutable versions, and explicit import.
-- Deliberately contains no seed INSERTs.
--
-- 可独立重放：全程 IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE。
-- migrate:check 会无视版本表强制重放每个文件，裸 CREATE 在第二遍必炸。
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stable_name text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('enabled','disabled')),
  creator_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_version_id text,
  CONSTRAINT agents_id_org_uniq UNIQUE (id,org_id),
  CONSTRAINT agents_stable_name_uniq UNIQUE (org_id,stable_name)
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_name_casefold_uniq ON agents(org_id,lower(name));

CREATE TABLE IF NOT EXISTS agent_versions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  semantic_label text NOT NULL,
  instruction_digest text NOT NULL CHECK (instruction_digest ~ '^[a-f0-9]{64}$'),
  instructions text NOT NULL,
  skill_version_ids text[] NOT NULL,
  model_provider text NOT NULL,
  model_id text NOT NULL,
  tool_policy jsonb NOT NULL CHECK (jsonb_typeof(tool_policy)='array' AND jsonb_array_length(tool_policy)=0),
  creator_id text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  CONSTRAINT agent_versions_id_org_uniq UNIQUE (id,org_id),
  CONSTRAINT agent_versions_id_org_agent_uniq UNIQUE (id,org_id,agent_id),
  CONSTRAINT agent_versions_agent_fk FOREIGN KEY (agent_id,org_id) REFERENCES agents(id,org_id) ON DELETE CASCADE,
  CONSTRAINT agent_versions_semantic_uniq UNIQUE (org_id,agent_id,semantic_label)
);
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_published_version_fk;
ALTER TABLE agents ADD CONSTRAINT agents_published_version_fk
  FOREIGN KEY (published_version_id,org_id,id) REFERENCES agent_versions(id,org_id,agent_id);

CREATE TABLE IF NOT EXISTS agent_starter_pack_imports (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  pack_version text NOT NULL,
  pack_digest text,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  administrator_id text NOT NULL,
  imported_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  result_json jsonb,
  failure_code text,
  CONSTRAINT agent_import_idempotency_uniq UNIQUE(org_id,idempotency_key),
  CONSTRAINT agent_import_status_shape CHECK (
    (status='pending' AND result_json IS NULL AND failure_code IS NULL) OR
    (status='succeeded' AND result_json IS NOT NULL AND failure_code IS NULL) OR
    (status='failed' AND result_json IS NULL AND failure_code IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION wave2_agent_version_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'published Agent versions are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS agent_versions_immutable_trg ON agent_versions;
CREATE TRIGGER agent_versions_immutable_trg BEFORE UPDATE OR DELETE ON agent_versions
  FOR EACH ROW EXECUTE FUNCTION wave2_agent_version_immutable();

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_starter_pack_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_starter_pack_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agents_tenant ON agents;
CREATE POLICY agents_tenant ON agents USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS agent_versions_tenant ON agent_versions;
CREATE POLICY agent_versions_tenant ON agent_versions USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS agent_imports_tenant ON agent_starter_pack_imports;
CREATE POLICY agent_imports_tenant ON agent_starter_pack_imports USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON agents,agent_versions,agent_starter_pack_imports FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON agents TO app_rw;
GRANT SELECT,INSERT ON agent_versions TO app_rw;
GRANT SELECT,INSERT,UPDATE ON agent_starter_pack_imports TO app_rw;
SELECT kernel_apply_org_freeze_policies();
