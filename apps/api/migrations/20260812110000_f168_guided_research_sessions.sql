-- F168 / #1080 -- resumable, owner-private guided Deep Research sessions.

CREATE TABLE IF NOT EXISTS guided_research_sessions (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_user_id   text NOT NULL,
  idempotency_key text NOT NULL,
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  brief           jsonb NOT NULL CHECK (jsonb_typeof(brief) = 'object'),
  stage           text NOT NULL CHECK (stage IN ('brief', 'directions', 'outline', 'researching', 'report', 'failed')),
  resume_stage    text NOT NULL CHECK (resume_stage IN ('brief', 'directions', 'outline', 'researching', 'report')),
  progress        integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  source_count    integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  report_id       text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS guided_research_sessions_owner_recent_idx
  ON guided_research_sessions (org_id, owner_user_id, updated_at DESC, id DESC);

ALTER TABLE guided_research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guided_research_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guided_research_sessions_tenant ON guided_research_sessions;
CREATE POLICY guided_research_sessions_tenant ON guided_research_sessions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON guided_research_sessions FROM app_rw;
GRANT SELECT, INSERT ON guided_research_sessions TO app_rw;
GRANT UPDATE (title, brief, stage, resume_stage, progress, source_count, report_id, updated_at)
  ON guided_research_sessions TO app_rw;

SELECT kernel_apply_org_freeze_policies();
