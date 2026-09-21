-- Respondent capabilities and real object metadata; no public object URLs.
CREATE TABLE IF NOT EXISTS survey_upload_sessions (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 survey_id text NOT NULL, token_hash text NOT NULL, submission_id text NOT NULL,
 publication_version integer NOT NULL, expires_at timestamptz NOT NULL,
 response_id text, PRIMARY KEY(org_id,token_hash)
);
CREATE TABLE IF NOT EXISTS survey_attachments (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 id text NOT NULL, survey_id text NOT NULL, session_hash text NOT NULL,
 question_id text NOT NULL, object_key text NOT NULL,
 name text NOT NULL, mime text NOT NULL, size_bytes integer NOT NULL CHECK(size_bytes>0),
 sha256 text NOT NULL, status text NOT NULL CHECK(status IN ('pending','ready','claimed','deleted')),
 expires_at timestamptz NOT NULL, response_id text,
 PRIMARY KEY(org_id,id), FOREIGN KEY(org_id,session_hash) REFERENCES survey_upload_sessions(org_id,token_hash)
);
CREATE INDEX IF NOT EXISTS survey_attachments_expiry ON survey_attachments(org_id,expires_at) WHERE status<>'claimed';
CREATE INDEX IF NOT EXISTS survey_upload_sessions_survey ON survey_upload_sessions(org_id,survey_id);
ALTER TABLE survey_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_upload_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_upload_sessions_tenant ON survey_upload_sessions;
CREATE POLICY survey_upload_sessions_tenant ON survey_upload_sessions USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
ALTER TABLE survey_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_attachments_tenant ON survey_attachments;
CREATE POLICY survey_attachments_tenant ON survey_attachments USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON survey_upload_sessions,survey_attachments TO app_rw;
SELECT kernel_apply_org_freeze_policies();
