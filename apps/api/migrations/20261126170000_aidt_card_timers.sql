CREATE TABLE aidt_card_timers (
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id integer NOT NULL CHECK (stage_id BETWEEN 1 AND 6),
  entity_id text NOT NULL,
  remaining_ms integer NOT NULL CHECK (remaining_ms BETWEEN 0 AND 86400000),
  ends_at_ms bigint,
  PRIMARY KEY (org_id, project_id, stage_id, entity_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);
ALTER TABLE aidt_card_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_card_timers FORCE ROW LEVEL SECURITY;
CREATE POLICY aidt_card_timers_tenant ON aidt_card_timers
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON aidt_card_timers TO app_rw;
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
