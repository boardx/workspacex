-- Runtime metadata only. All answer text is an immutable Markdown artifact version.
CREATE TABLE IF NOT EXISTS interview_markdown_execution (
  org_id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','paused','failed','completed')),
  sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array'),
  tasks jsonb NOT NULL CHECK(jsonb_typeof(tasks)='array'),
  claim_id text,
  claim_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,revision_id),
  FOREIGN KEY(org_id,interview_id) REFERENCES interview_sessions(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,revision_id) REFERENCES digital_interview_revisions(org_id,id) ON DELETE CASCADE
);
ALTER TABLE interview_markdown_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_markdown_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON interview_markdown_execution
 USING(org_id=current_setting('app.current_org',true))
 WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON interview_markdown_execution TO app_rw;
SELECT kernel_apply_org_freeze_policies();
