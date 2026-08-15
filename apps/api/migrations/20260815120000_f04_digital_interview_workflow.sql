-- Phase 04 F04: explicit-confirmation workflow persistence.
--
-- LangGraph checkpoints hold orchestration identifiers only. Confirmed interview content,
-- Skill messages/proposals, idempotency receipts, and version history remain normalized here.
-- Every tenant-owned relationship includes org_id so a foreign key can never cross tenants.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_sessions_org_id_id_uniq'
  ) THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT interview_sessions_org_id_id_uniq UNIQUE (org_id, id);
  END IF;
END $$;

-- F01 required topic for every digital row. F04 introduces topic_pending drafts whose topic is
-- deliberately NULL until explicit confirmation, while preserving legacy draft rows.
ALTER TABLE interview_sessions
  DROP CONSTRAINT IF EXISTS interview_sessions_digital_draft_fields_check;
ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_digital_draft_fields_check
  CHECK (
    digital_status IS NULL OR (
      source_kind = 'virtual'
      AND cardinality(tags) > 0
      AND version > 0
      AND (
        -- New F04 drafts enter topic_pending before confirmation (NULL topic), while
        -- pre-F04 callers may transition an already populated legacy draft. Both
        -- representations are valid and remain recoverable during the rollout.
        (digital_status = 'topic_pending' AND (
          topic IS NULL OR length(btrim(topic)) > 0
        ))
        OR (digital_status <> 'topic_pending' AND topic IS NOT NULL AND length(btrim(topic)) > 0)
      )
    )
  );

CREATE TABLE IF NOT EXISTS digital_interview_revisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  is_current boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, revision_number),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  CHECK ((is_current AND superseded_at IS NULL) OR (NOT is_current AND superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_revisions_one_current
  ON digital_interview_revisions(org_id, interview_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS digital_interview_topic_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  topic text NOT NULL CHECK (length(btrim(topic)) > 0),
  is_current boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, revision_id, version_number),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_topic_versions_one_current
  ON digital_interview_topic_versions(org_id, revision_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS digital_interview_expert_snapshot_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  is_current boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, revision_id, version_number),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_expert_snapshot_versions_one_current
  ON digital_interview_expert_snapshot_versions(org_id, revision_id) WHERE is_current;

-- Agent versions expose `(id,org_id,agent_id)` for their head FK. Interview tables keep every
-- tenant composite key org-first, so add the equivalent lookup order without duplicating data.
CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_org_id_id_agent_id_uniq
  ON agent_versions(org_id, id, agent_id);

CREATE TABLE IF NOT EXISTS digital_interview_expert_snapshots (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id text NOT NULL,
  expert_id text NOT NULL,
  agent_definition_id text NOT NULL,
  agent_version text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  initials text NOT NULL CHECK (length(btrim(initials)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  role text NOT NULL CHECK (length(btrim(role)) > 0),
  domains text[] NOT NULL CHECK (cardinality(domains) > 0),
  material_context_pack_id text,
  material_version text,
  PRIMARY KEY (org_id, version_id, expert_id),
  UNIQUE (org_id, version_id, ordinal),
  FOREIGN KEY (org_id, version_id)
    REFERENCES digital_interview_expert_snapshot_versions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, expert_id)
    REFERENCES digital_expert_profiles(org_id, agent_id),
  FOREIGN KEY (org_id, agent_version, agent_definition_id)
    REFERENCES agent_versions(org_id, id, agent_id),
  CHECK ((material_context_pack_id IS NULL) = (material_version IS NULL))
);

CREATE TABLE IF NOT EXISTS digital_interview_expert_candidates (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  expert_id text NOT NULL,
  agent_definition_id text NOT NULL,
  agent_version text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  initials text NOT NULL CHECK (length(btrim(initials)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  role text NOT NULL CHECK (length(btrim(role)) > 0),
  domains text[] NOT NULL CHECK (cardinality(domains) > 0),
  material_context_pack_id text,
  material_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, revision_id, expert_id),
  UNIQUE (org_id, revision_id, ordinal),
  FOREIGN KEY (org_id, revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, expert_id)
    REFERENCES digital_expert_profiles(org_id, agent_id),
  FOREIGN KEY (org_id, agent_version, agent_definition_id)
    REFERENCES agent_versions(org_id, id, agent_id),
  CHECK ((material_context_pack_id IS NULL) = (material_version IS NULL))
);

CREATE TABLE IF NOT EXISTS digital_interview_question_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  expert_snapshot_version_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  is_current boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, revision_id, version_number),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, expert_snapshot_version_id)
    REFERENCES digital_interview_expert_snapshot_versions(org_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_question_versions_one_current
  ON digital_interview_question_versions(org_id, revision_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS digital_interview_questions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id text NOT NULL,
  question_id text NOT NULL,
  expert_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0),
  PRIMARY KEY (org_id, version_id, question_id),
  UNIQUE (org_id, version_id, ordinal),
  FOREIGN KEY (org_id, version_id)
    REFERENCES digital_interview_question_versions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, expert_id)
    REFERENCES digital_expert_profiles(org_id, agent_id)
);

CREATE TABLE IF NOT EXISTS digital_interview_question_candidates (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  question_id text NOT NULL,
  expert_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  purpose text NOT NULL CHECK (length(btrim(purpose)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, revision_id, question_id),
  UNIQUE (org_id, revision_id, ordinal),
  FOREIGN KEY (org_id, revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, expert_id)
    REFERENCES digital_expert_profiles(org_id, agent_id)
);

CREATE TABLE IF NOT EXISTS digital_interview_skill_threads (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_interview_skill_messages (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  skill_thread_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, skill_thread_id, ordinal),
  FOREIGN KEY (org_id, skill_thread_id)
    REFERENCES digital_interview_skill_threads(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_interview_skill_proposals (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  skill_thread_id text NOT NULL,
  source_message_id text NOT NULL,
  target_step text NOT NULL CHECK (target_step IN ('topic', 'experts', 'questions', 'runs', 'report')),
  base_revision_id text NOT NULL,
  patch jsonb NOT NULL CHECK (jsonb_typeof(patch) = 'object'),
  status text NOT NULL CHECK (status IN ('proposed', 'applied_to_draft', 'rejected', 'committed', 'stale')),
  applied_at timestamptz,
  rejected_at timestamptz,
  committed_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, skill_thread_id)
    REFERENCES digital_interview_skill_threads(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, source_message_id)
    REFERENCES digital_interview_skill_messages(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, base_revision_id)
    REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'proposed' AND applied_at IS NULL AND rejected_at IS NULL AND committed_version_id IS NULL)
    OR (status = 'applied_to_draft' AND applied_at IS NOT NULL AND rejected_at IS NULL AND committed_version_id IS NULL)
    OR (status = 'rejected' AND applied_at IS NULL AND rejected_at IS NOT NULL AND committed_version_id IS NULL)
    OR (status = 'committed' AND applied_at IS NOT NULL AND rejected_at IS NULL AND committed_version_id IS NOT NULL)
    OR (status = 'stale' AND applied_at IS NULL AND rejected_at IS NULL AND committed_version_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS digital_interview_step_receipts (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_id text NOT NULL,
  operation_id text NOT NULL,
  operation_name text NOT NULL,
  request_id text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  http_status integer NOT NULL CHECK (http_status BETWEEN 200 AND 299),
  response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  response_version bigint NOT NULL CHECK (response_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, interview_id, operation_id),
  FOREIGN KEY (org_id, interview_id)
    REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_step_receipts_operation_uniq
  ON digital_interview_step_receipts(org_id, interview_id, operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_step_receipts_aggregate_request_uniq
  ON digital_interview_step_receipts(org_id, interview_id, operation_name, request_id);
CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_step_receipts_create_request_uniq
  ON digital_interview_step_receipts(org_id, operation_name, request_id)
  WHERE operation_name = 'create_draft';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'digital_interview_revisions',
    'digital_interview_topic_versions',
    'digital_interview_expert_snapshot_versions',
    'digital_interview_expert_snapshots',
    'digital_interview_expert_candidates',
    'digital_interview_question_versions',
    'digital_interview_questions',
    'digital_interview_question_candidates',
    'digital_interview_skill_threads',
    'digital_interview_skill_messages',
    'digital_interview_skill_proposals',
    'digital_interview_step_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      table_name || '_tenant', table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON
  digital_interview_revisions,
  digital_interview_topic_versions,
  digital_interview_expert_snapshot_versions,
  digital_interview_expert_snapshots,
  digital_interview_expert_candidates,
  digital_interview_question_versions,
  digital_interview_questions,
  digital_interview_question_candidates,
  digital_interview_skill_threads,
  digital_interview_skill_messages,
  digital_interview_skill_proposals,
  digital_interview_step_receipts
FROM app_rw;

GRANT SELECT, INSERT, UPDATE ON
  digital_interview_revisions,
  digital_interview_topic_versions,
  digital_interview_expert_snapshot_versions,
  digital_interview_expert_snapshots,
  digital_interview_expert_candidates,
  digital_interview_question_versions,
  digital_interview_questions,
  digital_interview_question_candidates,
  digital_interview_skill_threads,
  digital_interview_skill_messages,
  digital_interview_skill_proposals,
  digital_interview_step_receipts
TO app_rw;

GRANT DELETE ON
  digital_interview_expert_candidates,
  digital_interview_question_candidates
TO app_rw;

SELECT kernel_apply_org_freeze_policies();

-- Exact schema required by @langchain/langgraph-checkpoint-postgres 0.1.2. Keeping this DDL
-- in the deployment migration means application startup never needs schema-owner privileges.
CREATE SCHEMA IF NOT EXISTS langgraph_interview;
CREATE TABLE IF NOT EXISTS langgraph_interview.checkpoint_migrations (
  v integer PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS langgraph_interview.checkpoints (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS langgraph_interview.checkpoint_blobs (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  channel text NOT NULL,
  version text NOT NULL,
  type text NOT NULL,
  blob bytea,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
CREATE TABLE IF NOT EXISTS langgraph_interview.checkpoint_writes (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  idx integer NOT NULL,
  channel text NOT NULL,
  type text,
  blob bytea NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
ALTER TABLE langgraph_interview.checkpoint_blobs ALTER COLUMN blob DROP NOT NULL;
INSERT INTO langgraph_interview.checkpoint_migrations(v)
VALUES (0), (1), (2), (3), (4)
ON CONFLICT (v) DO NOTHING;

REVOKE ALL ON SCHEMA langgraph_interview FROM PUBLIC;
GRANT USAGE ON SCHEMA langgraph_interview TO app_rw;
REVOKE ALL ON ALL TABLES IN SCHEMA langgraph_interview FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA langgraph_interview TO app_rw;
