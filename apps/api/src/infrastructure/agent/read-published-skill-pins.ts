import type { TenantSession } from "../../application/ports/database.port";
import { PLATFORM_ORG_ID } from "../../domain/org-id";

/** Resolve only exact published versions visible in the tenant or shared platform. */
export async function readPublishedSkillPins(session: TenantSession, orgId: string, ids: readonly string[]) {
  const versions = [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))];
  if (!versions.length) return [];
  const result = await session.query<{ skill_id: string; version_id: string }>(
    `SELECT sk.id AS skill_id, sv.id AS version_id
       FROM skill_versions sv JOIN skills sk ON sk.id=sv.skill_id AND sk.org_id=sv.org_id
      WHERE (sv.org_id=$1 OR sv.org_id=$3) AND sv.id=ANY($2::text[]) AND sv.published`,
    [orgId, versions, PLATFORM_ORG_ID],
  );
  const byVersion = new Map(result.rows.map(pin => [pin.version_id, pin.skill_id]));
  return versions.flatMap(versionId => {
    const skillId = byVersion.get(versionId);
    return skillId ? [{ skillId, versionId }] : [];
  });
}
