-- F168 / #1080 -- resumable guided Deep Research sessions visible to owners and explicit collaborators.

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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'guided_research_sessions_id_org_uniq'
       AND conrelid = 'guided_research_sessions'::regclass
  ) THEN
    ALTER TABLE guided_research_sessions
      ADD CONSTRAINT guided_research_sessions_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS guided_research_session_collaborators (
  session_id text NOT NULL,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  added_by   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS guided_research_session_collaborators_user_idx
  ON guided_research_session_collaborators (org_id, user_id, session_id);

CREATE INDEX IF NOT EXISTS guided_research_sessions_owner_recent_idx
  ON guided_research_sessions (org_id, owner_user_id, updated_at DESC, id DESC);

ALTER TABLE guided_research_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guided_research_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE guided_research_session_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE guided_research_session_collaborators FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guided_research_sessions_tenant ON guided_research_sessions;
CREATE POLICY guided_research_sessions_tenant ON guided_research_sessions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS guided_research_session_collaborators_tenant ON guided_research_session_collaborators;
CREATE POLICY guided_research_session_collaborators_tenant ON guided_research_session_collaborators
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON guided_research_sessions FROM app_rw;
REVOKE ALL ON guided_research_session_collaborators FROM app_rw;
GRANT SELECT, INSERT ON guided_research_sessions TO app_rw;
GRANT SELECT, INSERT, DELETE ON guided_research_session_collaborators TO app_rw;
GRANT UPDATE (title, brief, stage, resume_stage, progress, source_count, report_id, updated_at)
  ON guided_research_sessions TO app_rw;

SELECT kernel_apply_org_freeze_policies();
