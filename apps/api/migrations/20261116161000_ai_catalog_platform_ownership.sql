-- The catalog is owned by the platform organization. Only publication coordinates
-- and managed-entity markers are shared with consuming organizations.
ALTER TABLE ai_catalog_managed
  ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'org-platform'
    REFERENCES organizations(id) ON DELETE CASCADE CHECK (org_id = 'org-platform');
ALTER TABLE ai_catalog_publications
  ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'org-platform'
    REFERENCES organizations(id) ON DELETE CASCADE CHECK (org_id = 'org-platform');

DROP POLICY IF EXISTS ai_catalog_managed_write ON ai_catalog_managed;
CREATE POLICY ai_catalog_managed_write ON ai_catalog_managed FOR ALL
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS ai_catalog_public_write ON ai_catalog_publications;
CREATE POLICY ai_catalog_public_write ON ai_catalog_publications FOR ALL
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE SELECT, UPDATE, DELETE ON ai_catalog_publications FROM app_rw;
GRANT SELECT (kind, entity_id, version_id, published_at) ON ai_catalog_publications TO app_rw;

SELECT kernel_apply_org_freeze_policies();
