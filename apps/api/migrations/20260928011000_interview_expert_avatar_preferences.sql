-- Saved Markdown experts are interview identities, not synthetic organization Agents.
CREATE TABLE IF NOT EXISTS interview_expert_avatar_preferences (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  interview_id text NOT NULL,
  expert_id text NOT NULL,
  avatar_key text,
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor_id, interview_id, expert_id),
  FOREIGN KEY (interview_id, org_id) REFERENCES interview_sessions(id, org_id) ON DELETE CASCADE
);
ALTER TABLE interview_expert_avatar_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_expert_avatar_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interview_expert_avatar_preferences_tenant ON interview_expert_avatar_preferences;
CREATE POLICY interview_expert_avatar_preferences_tenant ON interview_expert_avatar_preferences
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
GRANT SELECT, INSERT, UPDATE ON interview_expert_avatar_preferences TO app_rw;
SELECT kernel_apply_org_freeze_policies();
