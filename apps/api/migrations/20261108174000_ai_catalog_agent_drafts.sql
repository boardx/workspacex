CREATE TABLE ai_catalog_agent_drafts (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 agent_id text NOT NULL, base_version_id text NOT NULL, input jsonb NOT NULL,
 PRIMARY KEY(org_id,agent_id)
);
ALTER TABLE ai_catalog_agent_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_catalog_agent_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_catalog_agent_drafts_tenant ON ai_catalog_agent_drafts FOR ALL USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON ai_catalog_agent_drafts TO app_rw;
