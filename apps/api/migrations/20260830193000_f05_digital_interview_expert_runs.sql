CREATE TABLE IF NOT EXISTS digital_interview_expert_runs (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  expert_id text NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  total_questions integer NOT NULL CHECK (total_questions >= 0),
  answers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(answers) = 'array'),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, revision_id, expert_id),
  UNIQUE (org_id, revision_id, ordinal),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE
);
ALTER TABLE digital_interview_expert_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_interview_expert_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON digital_interview_expert_runs;
CREATE POLICY tenant_isolation ON digital_interview_expert_runs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON digital_interview_expert_runs FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON digital_interview_expert_runs TO app_rw;
SELECT kernel_apply_org_freeze_policies();
