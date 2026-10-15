-- Organization physical deletion follows existing f159 audit retention: receipts remain append-only while the organization exists.
CREATE TABLE IF NOT EXISTS report_skill_file_jobs (
 id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_user_id text NOT NULL REFERENCES credentials(user_id), request_id uuid NOT NULL UNIQUE,
 metadata jsonb NOT NULL, state text NOT NULL CHECK (state IN ('queued','running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 lease_token uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE report_skill_file_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_skill_file_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON report_skill_file_jobs;
CREATE POLICY tenant_scope ON report_skill_file_jobs
 USING (org_id=current_setting('app.current_org',true))
 WITH CHECK (org_id=current_setting('app.current_org',true));
GRANT SELECT, INSERT, UPDATE ON report_skill_file_jobs TO app_rw;
CREATE INDEX IF NOT EXISTS report_skill_file_jobs_actor ON report_skill_file_jobs(org_id,actor_user_id,created_at);
SELECT kernel_apply_org_freeze_policies();
