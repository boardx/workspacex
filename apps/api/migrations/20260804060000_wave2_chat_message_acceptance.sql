-- Wave 2 / #415: durable human-message acceptance and queued AgentRun snapshot.
--
-- Agent/Skill definitions remain owned by #417/#412. This migration stores only the exact
-- immutable IDs/model selected at acceptance; it does not create or publish catalog content.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id uuid NULL,
  ADD COLUMN IF NOT EXISTS requested_agent_id text NULL,
  ADD COLUMN IF NOT EXISTS agent_run_id text NULL,
  ADD COLUMN IF NOT EXISTS reply_to_message_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_human_idempotency_idx
  ON chat_messages (org_id, thread_id, author_id, client_message_id)
  WHERE author_kind = 'human' AND client_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_agent_run_idx
  ON chat_messages (org_id, agent_run_id)
  WHERE author_kind = 'agent' AND agent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_messages_stable_page_idx
  ON chat_messages (org_id, thread_id, created_at, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id         text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  input_message_id  text NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  agent_id           text NOT NULL,
  agent_version_id   text NOT NULL,
  skill_version_ids  jsonb NOT NULL CHECK (jsonb_typeof(skill_version_ids) = 'array'),
  model_provider     text NOT NULL,
  model_id           text NOT NULL,
  status             text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','writeback_pending','succeeded','failed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, input_message_id)
);

CREATE INDEX IF NOT EXISTS agent_runs_thread_idx
  ON agent_runs (org_id, thread_id, created_at, id);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_runs_tenant ON agent_runs;
CREATE POLICY agent_runs_tenant ON agent_runs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_runs TO app_rw;

SELECT kernel_apply_org_freeze_policies();
