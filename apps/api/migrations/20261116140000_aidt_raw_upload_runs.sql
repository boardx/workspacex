-- Upload receipt -> actual immutable artifact version. Never use versionId as a run id.
CREATE TABLE IF NOT EXISTS aidt_raw_upload_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
  filename text NOT NULL CHECK(length(filename)>0),
  mime text NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK(size_bytes>0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(id<>artifact_id AND id<>artifact_version_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS aidt_raw_upload_runs_project ON aidt_raw_upload_runs(org_id,project_id);
ALTER TABLE aidt_raw_upload_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_raw_upload_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_raw_upload_runs_tenant ON aidt_raw_upload_runs;
CREATE POLICY aidt_raw_upload_runs_tenant ON aidt_raw_upload_runs
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_raw_upload_runs FROM app_rw;
GRANT SELECT,INSERT ON aidt_raw_upload_runs TO app_rw;
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_raw_upload_runs IS 'AIDT raw upload receipt for an immutable original; STORED is not transcription, retrieval readiness or validated evidence.';
