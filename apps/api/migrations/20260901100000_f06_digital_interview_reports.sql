CREATE TABLE IF NOT EXISTS digital_interview_reports (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  executive_summary text NOT NULL CHECK (length(btrim(executive_summary)) > 0),
  markdown text NOT NULL CHECK (length(btrim(markdown)) > 0),
  findings jsonb NOT NULL CHECK (jsonb_typeof(findings) = 'array'),
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, report_id),
  UNIQUE (org_id, interview_id, revision_id),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE
);
ALTER TABLE digital_interview_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_interview_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON digital_interview_reports;
CREATE POLICY tenant_isolation ON digital_interview_reports
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON digital_interview_reports FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON digital_interview_reports TO app_rw;
SELECT kernel_apply_org_freeze_policies();
