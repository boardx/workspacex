-- Human review metadata references immutable Markdown; report content is never copied.
CREATE TABLE IF NOT EXISTS interview_markdown_report_reviews (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  document_id text NOT NULL,
  document_version integer NOT NULL CHECK(document_version > 0),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('approved','changes_requested')),
  note text CHECK(note IS NULL OR length(note)<=1000),
  request_id text NOT NULL,
  expected_version bigint NOT NULL CHECK(expected_version>0),
  aggregate_version bigint NOT NULL CHECK(aggregate_version=expected_version+1),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,id),
  UNIQUE(org_id,interview_id,request_id),
  FOREIGN KEY(interview_id,org_id) REFERENCES interview_sessions(id,org_id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,revision_id) REFERENCES digital_interview_revisions(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,document_id) REFERENCES digital_interview_artifact_versions(org_id,artifact_id) ON DELETE CASCADE
);
ALTER TABLE interview_markdown_report_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_markdown_report_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_markdown_report_reviews_tenant ON interview_markdown_report_reviews;
CREATE POLICY interview_markdown_report_reviews_tenant ON interview_markdown_report_reviews
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON interview_markdown_report_reviews TO app_rw;
SELECT kernel_apply_org_freeze_policies();
