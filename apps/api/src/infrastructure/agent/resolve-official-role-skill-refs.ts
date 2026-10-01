import type { PendingSkillBinding } from "@repo/contracts/agent-role";
import type { TenantSession } from "../../application/ports/database.port";
import type { OfficialAgentStarterPack } from "../../domain/agent/starter-pack";
import { buildOfficialAgentRolePack, OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../domain/agent/official-role-packs";

export interface ResolvedOfficialRoleSkills {
  readonly pins: readonly string[];
  readonly pending: readonly PendingSkillBinding[];
}

/** Call within the import/upgrade transaction: only tenant-local, published, verified exact content is executable. */
export async function resolveOfficialRoleSkillRefs(
  session: TenantSession,
  orgId: string,
  pack: OfficialAgentStarterPack,
): Promise<ReadonlyMap<string, ResolvedOfficialRoleSkills>> {
  const current = pack.packId === OFFICIAL_AGENT_ROLE_PACK_ID && pack.packVersion === OFFICIAL_AGENT_ROLE_PACK_VERSION &&
    pack.packDigest === buildOfficialAgentRolePack().packDigest;
  const result = new Map<string, ResolvedOfficialRoleSkills>();
  for (const agent of pack.agents) {
    // Other signed packs retain their existing explicit-version validation; no global Skill fallback.
    if (!current) { result.set(agent.stableName, { pins: agent.skillVersions.map((ref) => ref.versionId), pending: [] }); continue; }
    const coordinates = agent.authoredSkillBindings;
    if (!coordinates) throw new Error("unknown_official_role_skill_coordinates");
    const pins: string[] = []; const pending: PendingSkillBinding[] = [];
    for (const coordinate of coordinates) {
      const found = await session.query<{
        skill_id: string; version_id: string; name: string; channel: string; published: boolean;
      }>(
        `SELECT s.id AS skill_id, v.id AS version_id, s.name, e.channel, v.published
           FROM skill_versions v JOIN skills s ON s.id=v.skill_id AND s.org_id=v.org_id
           JOIN skill_catalog_entries e ON e.skill_id=s.id AND e.org_id=s.org_id
          WHERE v.org_id=$1 AND e.stable_id=$2 AND s.stable_name=$3 AND v.content_digest=$4
          ORDER BY v.published DESC, v.created_at DESC, v.id DESC LIMIT 1`,
        [orgId, coordinate.stableId, coordinate.stableName, coordinate.contentDigest],
      );
      const row = found.rows[0];
      if (row?.published && row.channel === "verified") pins.push(row.version_id);
      else pending.push({
        stableId: coordinate.stableId, stableName: coordinate.stableName, contentDigest: coordinate.contentDigest,
        reason: row?.published ? "awaiting_verification" : "missing_version",
        ...(row ? { skillId: row.skill_id, versionId: row.version_id, displayName: row.name } : {}),
      });
    }
    result.set(agent.stableName, { pins, pending });
  }
  return result;
}
