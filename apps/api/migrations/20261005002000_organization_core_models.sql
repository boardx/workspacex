-- Empty additive storage: no default selection, existing agent version or run is changed.
CREATE TABLE IF NOT EXISTS organization_core_models (
 org_id text NOT NULL,version integer NOT NULL,model_id text NOT NULL,model_provider text NOT NULL,runtime_model_id text NOT NULL,
 config_revision text NOT NULL,private_connection_id text NOT NULL,updated_by text NOT NULL,reason text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_core_model_changes (
 org_id text NOT NULL,version integer NOT NULL,model_id text NOT NULL,model_provider text NOT NULL,runtime_model_id text NOT NULL,
 config_revision text NOT NULL,private_connection_id text NOT NULL,updated_by text NOT NULL,reason text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_run_core_model_snapshots (
 org_id text NOT NULL,run_id text NOT NULL,selection_version integer NOT NULL,model_id text NOT NULL,model_provider text NOT NULL,runtime_model_id text NOT NULL,
 config_revision text NOT NULL,private_connection_id text NOT NULL,selected_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE rule record; BEGIN
 FOR rule IN SELECT * FROM (VALUES
  ('organization_core_models','organization_core_models_pkey','PRIMARY KEY(org_id)'),
  ('organization_core_models','organization_core_models_org_fk','FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE'),
  ('organization_core_models','organization_core_models_version_check','CHECK(version>0)'),
  ('organization_core_models','organization_core_models_fields_check','CHECK(length(model_id) BETWEEN 1 AND 200 AND length(model_provider) BETWEEN 1 AND 200 AND length(runtime_model_id) BETWEEN 1 AND 200 AND length(config_revision) BETWEEN 1 AND 200 AND length(private_connection_id) BETWEEN 1 AND 200 AND length(reason) BETWEEN 1 AND 1000)'),
  ('organization_core_model_changes','organization_core_model_changes_pkey','PRIMARY KEY(org_id,version)'),
  ('organization_core_model_changes','organization_core_model_changes_org_fk','FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE'),
  ('organization_core_model_changes','organization_core_model_changes_fields_check','CHECK(version>0 AND length(reason) BETWEEN 1 AND 1000)'),
  ('agent_run_core_model_snapshots','agent_run_core_model_snapshots_pkey','PRIMARY KEY(org_id,run_id)'),
  ('agent_run_core_model_snapshots','agent_run_core_model_snapshots_run_fk','FOREIGN KEY(run_id,org_id) REFERENCES agent_runs(id,org_id) ON DELETE CASCADE'),
  ('agent_run_core_model_snapshots','agent_run_core_model_snapshots_revision_fk','FOREIGN KEY(org_id,selection_version) REFERENCES organization_core_model_changes(org_id,version) ON DELETE CASCADE'),
  ('agent_run_core_model_snapshots','agent_run_core_model_snapshots_version_check','CHECK(selection_version>0)')
 ) AS definitions(table_name,constraint_name,definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(rule.table_name) AND conname=rule.constraint_name) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',rule.table_name,rule.constraint_name,rule.definition);
  END IF;
 END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organization_core_models','organization_core_model_changes','agent_run_core_model_snapshots'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(org_id=current_setting(''app.current_org'',true)) WITH CHECK(org_id=current_setting(''app.current_org'',true))',t);
 END LOOP;
END $$;
REVOKE ALL ON organization_core_models,organization_core_model_changes,agent_run_core_model_snapshots FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON organization_core_models TO app_rw;
GRANT SELECT,INSERT ON organization_core_model_changes,agent_run_core_model_snapshots TO app_rw;
DROP TRIGGER IF EXISTS org_core_model_changes_append_only ON organization_core_model_changes;
CREATE TRIGGER org_core_model_changes_append_only BEFORE UPDATE OR DELETE ON organization_core_model_changes FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
DROP TRIGGER IF EXISTS run_core_model_snapshot_append_only ON agent_run_core_model_snapshots;
CREATE TRIGGER run_core_model_snapshot_append_only BEFORE UPDATE OR DELETE ON agent_run_core_model_snapshots FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
-- Tenant and snapshot identity are DB invariants, not only repository conventions.
CREATE OR REPLACE FUNCTION enforce_org_core_model_identity() RETURNS trigger AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id AND kind='organization') OR
    NOT EXISTS(SELECT 1 FROM models WHERE id=NEW.model_id AND org_id=NEW.org_id) THEN
  RAISE EXCEPTION 'organization core model ownership mismatch';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS org_core_model_identity ON organization_core_models;
CREATE TRIGGER org_core_model_identity BEFORE INSERT OR UPDATE ON organization_core_models FOR EACH ROW EXECUTE FUNCTION enforce_org_core_model_identity();
DROP TRIGGER IF EXISTS org_core_model_audit_identity ON organization_core_model_changes;
CREATE TRIGGER org_core_model_audit_identity BEFORE INSERT ON organization_core_model_changes FOR EACH ROW EXECUTE FUNCTION enforce_org_core_model_identity();
CREATE OR REPLACE FUNCTION enforce_run_core_model_snapshot() RETURNS trigger AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_core_model_changes c WHERE c.org_id=NEW.org_id AND c.version=NEW.selection_version
   AND c.model_id=NEW.model_id AND c.model_provider=NEW.model_provider AND c.runtime_model_id=NEW.runtime_model_id
   AND c.config_revision=NEW.config_revision AND c.private_connection_id=NEW.private_connection_id) OR
    NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.org_id=NEW.org_id AND r.id=NEW.run_id
   AND r.model_provider IN ('deep-agent',NEW.model_provider) AND r.model_id=NEW.runtime_model_id) THEN
  RAISE EXCEPTION 'core model run snapshot mismatch';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS run_core_model_snapshot_identity ON agent_run_core_model_snapshots;
CREATE TRIGGER run_core_model_snapshot_identity BEFORE INSERT ON agent_run_core_model_snapshots FOR EACH ROW EXECUTE FUNCTION enforce_run_core_model_snapshot();
REVOKE ALL ON FUNCTION enforce_org_core_model_identity(),enforce_run_core_model_snapshot() FROM PUBLIC;
SELECT kernel_apply_org_freeze_policies();
