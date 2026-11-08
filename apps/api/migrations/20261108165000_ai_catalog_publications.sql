CREATE TABLE ai_catalog_managed(kind text NOT NULL CHECK(kind IN ('agent','skill')),entity_id text NOT NULL,PRIMARY KEY(kind,entity_id));
ALTER TABLE ai_catalog_managed ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_catalog_managed FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_catalog_managed_read ON ai_catalog_managed FOR SELECT USING(true);
CREATE POLICY ai_catalog_managed_write ON ai_catalog_managed FOR ALL USING(current_setting('app.current_org',true)='org-platform') WITH CHECK(current_setting('app.current_org',true)='org-platform');
GRANT SELECT,INSERT ON ai_catalog_managed TO app_rw;
CREATE TABLE ai_catalog_publications (
 kind text NOT NULL CHECK(kind IN ('agent','skill')), entity_id text NOT NULL,
 version_id text NOT NULL, published_by text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,entity_id,version_id)
);
CREATE TABLE ai_catalog_enablements (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('agent','skill')),
 origin_id text NOT NULL, origin_version_id text NOT NULL, local_id text NOT NULL, local_version_id text NOT NULL,
 enabled_by text NOT NULL, idempotency_key text NOT NULL, enabled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,kind,origin_id,origin_version_id), UNIQUE(org_id,idempotency_key)
);
ALTER TABLE ai_catalog_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_catalog_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_catalog_public_read ON ai_catalog_publications FOR SELECT USING(true);
CREATE POLICY ai_catalog_public_write ON ai_catalog_publications FOR ALL USING(current_setting('app.current_org',true)='org-platform') WITH CHECK(current_setting('app.current_org',true)='org-platform');
ALTER TABLE ai_catalog_enablements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_catalog_enablements FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_catalog_enable_tenant ON ai_catalog_enablements FOR ALL USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON ai_catalog_publications,ai_catalog_enablements TO app_rw;
CREATE TABLE ai_catalog_changes(id bigserial PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,actor_id text NOT NULL,action text NOT NULL,kind text NOT NULL,entity_id text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ai_catalog_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_catalog_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_catalog_changes_tenant ON ai_catalog_changes FOR ALL USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON ai_catalog_changes TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE ai_catalog_changes_id_seq TO app_rw;
