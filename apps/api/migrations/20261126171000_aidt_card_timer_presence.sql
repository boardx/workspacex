CREATE TABLE IF NOT EXISTS aidt_card_timer_presence (
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id integer NOT NULL CHECK (stage_id BETWEEN 1 AND 6),
  entity_id text NOT NULL,
  user_id text NOT NULL,
  session_id uuid NOT NULL,
  expires_at_ms bigint NOT NULL,
  departed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (org_id, project_id, stage_id, entity_id, user_id, session_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);
ALTER TABLE aidt_card_timer_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_card_timer_presence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_card_timer_presence_tenant ON aidt_card_timer_presence;
CREATE POLICY aidt_card_timer_presence_tenant ON aidt_card_timer_presence
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON aidt_card_timer_presence TO app_rw;
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
