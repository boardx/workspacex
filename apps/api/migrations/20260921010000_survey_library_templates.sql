-- Personal question/report templates remain separate from live questionnaire aggregates.
CREATE TABLE IF NOT EXISTS survey_library_templates (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  owner_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('question','report')),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,id),
  CHECK(document->>'id'=id),
  CHECK(document->>'kind'=kind)
);
CREATE INDEX IF NOT EXISTS survey_library_templates_owner ON survey_library_templates(org_id,owner_id,kind,updated_at DESC);
ALTER TABLE survey_library_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_library_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_library_templates_tenant ON survey_library_templates;
CREATE POLICY survey_library_templates_tenant ON survey_library_templates
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_library_templates TO app_rw;
SELECT kernel_apply_org_freeze_policies();
