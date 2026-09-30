/** Actual INSERT column lists shared by canonical bootstrap/seed writes and read-only preflight. */
export const BOOTSTRAP_WRITE_COLUMNS = {
  marker: ["singleton", "consumed_at"],
  credential: ["user_id", "email", "display_name", "password_hash", "email_verified_at"],
  organization: ["id", "name", "kind"],
  personalLocal: ["id", "name", "kind", "owner_user_id"],
  membership: ["user_id", "org_id", "org_role", "team_id"],
  agentInsertColumns: ["id", "org_id", "stable_name", "name", "status", "creator_id", "created_at", "updated_at", "published_version_id", "role_label", "role_label_needs_confirmation"],
  version: ["id", "org_id", "agent_id", "semantic_label", "instruction_digest", "instructions", "skill_version_ids", "model_provider", "model_id", "tool_policy", "creator_id", "created_at", "published_at"],
  listing: ["id", "org_id", "kind", "name", "abbr", "duty", "scope", "owner_team_id", "enabled", "endpoint", "role_label", "role_label_needs_confirmation"],
} as const;
