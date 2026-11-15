-- User-approved A: shared working drafts, append-only; no completion or consensus state.
CREATE TABLE aidt_stage_revisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id integer NOT NULL CHECK(stage_id BETWEEN 1 AND 6),
  revision integer NOT NULL CHECK(revision > 0),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND content->>'schemaVersion'='1'),
  source_stage_revisions jsonb NOT NULL CHECK(jsonb_typeof(source_stage_revisions)='array'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid NOT NULL,
  request_key text NOT NULL,
  PRIMARY KEY(org_id,project_id,stage_id,revision),
  UNIQUE(org_id,project_id,updated_by,operation_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id) ON DELETE CASCADE
);
ALTER TABLE aidt_stage_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_stage_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY aidt_stage_revisions_tenant ON aidt_stage_revisions
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_stage_revisions FROM app_rw;
GRANT SELECT,INSERT ON aidt_stage_revisions TO app_rw;
-- Single-column project FK makes this table discoverable by existing archive policy installer.
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_stage_revisions IS 'AIDT student-authored shared working drafts, not verified evidence or learning completion. Immutable revisions and actor-scoped operation receipt.';
