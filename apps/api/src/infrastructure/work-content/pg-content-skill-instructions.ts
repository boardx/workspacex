import { loadPinnedMethodFiles } from "./pinned-method-files";
import type { ContentSkillInstructionsPort } from "../../application/work-content/content-skill-runner";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";

/** Existing instances keep their pinned published version even when a newer version is imported. */
export class PgContentSkillInstructions implements ContentSkillInstructionsPort {
  constructor(private readonly db: DatabasePort) {}

  skillInstructions(orgId: string, stableId: string, semanticVersion: string): Promise<string | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ content: Buffer }>(
        `SELECT f.content
           FROM skill_catalog_entries e
           JOIN skill_versions v ON v.org_id = e.org_id AND v.skill_id = e.skill_id
           JOIN skill_version_files f ON f.org_id = v.org_id AND f.version_id = v.id
          WHERE e.org_id = $1 AND e.stable_id = $2
            AND v.semantic_label = $3 AND v.published AND f.path = 'SKILL.md'`,
        [orgId, stableId, semanticVersion],
      );
      const root = rows[0]?.content.toString("utf8") ?? null;
      if (!root?.trim()) return root;
      return loadPinnedMethodFiles(root, `${stableId}@${semanticVersion}`, async (path) => {
        const result = await s.query<{ content: Buffer }>(
          `SELECT f.content
             FROM skill_catalog_entries e
             JOIN skill_versions v ON v.org_id = e.org_id AND v.skill_id = e.skill_id
             JOIN skill_version_files f ON f.org_id = v.org_id AND f.version_id = v.id
            WHERE e.org_id = $1 AND e.stable_id = $2
              AND v.semantic_label = $3 AND v.published AND f.path = $4`,
          [orgId, stableId, semanticVersion, path],
        );
        return result.rows[0]?.content.toString("utf8") ?? null;
      });
    });
  }
}
