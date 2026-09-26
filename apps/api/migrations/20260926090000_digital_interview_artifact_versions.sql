-- Retained as an immutable historical migration. The workbench code that
-- previously consumed this table has been reverted, but deployed databases
-- may already have applied this version; removing it would make fresh and
-- upgraded schemas diverge.
CREATE TABLE IF NOT EXISTS digital_interview_artifact_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  artifact_id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  step text NOT NULL CHECK (step IN ('intake','analysis','experts','outline','runs','report')),
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  markdown text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft','confirmed','generating','failed','completed')),
  generated_at timestamptz,
  failure jsonb,
  evidence_mode text NOT NULL CHECK (evidence_mode IN ('simulated','participant','mixed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, artifact_id),
  UNIQUE (org_id, interview_id, revision_id, step, version_number),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  CHECK ((status NOT IN ('confirmed','completed')) OR length(btrim(markdown)) > 0),
  CHECK ((status <> 'failed') OR failure IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS digital_interview_artifact_versions_current
  ON digital_interview_artifact_versions(org_id, interview_id, revision_id, step, version_number DESC);
ALTER TABLE digital_interview_artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_interview_artifact_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON digital_interview_artifact_versions;
CREATE POLICY tenant_isolation ON digital_interview_artifact_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON digital_interview_artifact_versions FROM app_rw;
GRANT SELECT, INSERT ON digital_interview_artifact_versions TO app_rw;
SELECT kernel_apply_org_freeze_policies();
