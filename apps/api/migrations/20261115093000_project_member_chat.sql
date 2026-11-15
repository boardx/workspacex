-- Approved A+B review 33b1c4e...: independent pure human channel, no AI thread/run rows.
-- The locked counter and insertion commit together; sequence never overtakes an uncommitted message.
CREATE TABLE IF NOT EXISTS project_member_chat_channels (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence >= 0 AND last_sequence <= 9007199254740991),
  PRIMARY KEY(org_id, project_id),
  FOREIGN KEY(project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_member_chat_messages (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  sequence bigint NOT NULL CHECK(sequence > 0 AND sequence <= 9007199254740991),
  author_id text NOT NULL,
  client_message_id uuid NOT NULL,
  text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 4000),
  thread_root_id uuid,
  stage_reference jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id, project_id, id),
  UNIQUE(org_id, project_id, sequence),
  UNIQUE(org_id, project_id, author_id, client_message_id),
  FOREIGN KEY(org_id, project_id) REFERENCES project_member_chat_channels(org_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY(org_id, project_id, thread_root_id) REFERENCES project_member_chat_messages(org_id, project_id, id),
  CHECK(thread_root_id IS NULL OR thread_root_id <> id),
  CHECK(stage_reference IS NULL OR (jsonb_typeof(stage_reference) = 'object'
    AND stage_reference ? 'stageId' AND (stage_reference->>'stageId')::integer BETWEEN 1 AND 6))
);
CREATE INDEX IF NOT EXISTS project_member_chat_roots_idx ON project_member_chat_messages(org_id, project_id, sequence DESC) WHERE thread_root_id IS NULL;
CREATE INDEX IF NOT EXISTS project_member_chat_replies_idx ON project_member_chat_messages(org_id, project_id, thread_root_id, sequence);
ALTER TABLE project_member_chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member_chat_channels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_member_chat_channels_tenant ON project_member_chat_channels;
CREATE POLICY project_member_chat_channels_tenant ON project_member_chat_channels
  USING(org_id = current_setting('app.current_org', true)) WITH CHECK(org_id = current_setting('app.current_org', true));
ALTER TABLE project_member_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member_chat_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_member_chat_messages_tenant ON project_member_chat_messages;
CREATE POLICY project_member_chat_messages_tenant ON project_member_chat_messages
  USING(org_id = current_setting('app.current_org', true)) WITH CHECK(org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON project_member_chat_channels TO app_rw;
GRANT SELECT, INSERT ON project_member_chat_messages TO app_rw;
SELECT kernel_apply_org_freeze_policies();

-- Direct project_id foreign keys intentionally let the existing catalog installer discover both tables.
SELECT kernel_apply_project_archive_policies();
