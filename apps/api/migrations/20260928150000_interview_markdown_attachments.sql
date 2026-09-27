-- Original binary metadata only; extracted research content lives in Markdown artifacts.
CREATE TABLE IF NOT EXISTS interview_markdown_attachments (
 org_id text NOT NULL,
 asset_id text NOT NULL,
 interview_id text NOT NULL,
 revision_id text NOT NULL,
 storage_ref text NOT NULL,
 filename text NOT NULL,
 mime text NOT NULL,
 bytes integer NOT NULL CHECK(bytes>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,asset_id),
 FOREIGN KEY(org_id,interview_id) REFERENCES interview_sessions(org_id,id) ON DELETE CASCADE,
 FOREIGN KEY(org_id,revision_id) REFERENCES digital_interview_revisions(org_id,id) ON DELETE CASCADE
);
ALTER TABLE interview_markdown_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_markdown_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON interview_markdown_attachments
 USING(org_id=current_setting('app.current_org',true))
 WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON interview_markdown_attachments TO app_rw;
SELECT kernel_apply_org_freeze_policies();
