/** Shared read predicate for message resolution and capability availability (aliases a/v). */
export const PUBLISHED_AGENT_VERSION_MATCH =
  "v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id AND v.published_at IS NOT NULL";
export const PUBLISHED_AGENT_ENABLED = "a.status='enabled'";
