-- Personal presentation preferences. Research bodies and expert agent versions remain independent.
CREATE TABLE IF NOT EXISTS digital_expert_avatar_preferences (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  expert_id text NOT NULL,
  avatar_key text,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor_id, expert_id),
  FOREIGN KEY (expert_id, org_id) REFERENCES agents(id, org_id) ON DELETE CASCADE
);
ALTER TABLE digital_expert_avatar_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_expert_avatar_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS digital_expert_avatar_preferences_tenant ON digital_expert_avatar_preferences;
CREATE POLICY digital_expert_avatar_preferences_tenant ON digital_expert_avatar_preferences
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON digital_expert_avatar_preferences TO app_rw;
SELECT kernel_apply_org_freeze_policies();
