/** #3249: model-A byte-preserving snapshots; same lock and publication function as imports. */
import { createHash, randomUUID } from "node:crypto";
import { SkillFileSnapshot } from "@repo/contracts/skill-file-edit";
import type { DatabasePort } from "../../application/ports/database.port";
import { SkillFileEditError, type SkillFileEditRepository, type SkillFileSnapshotValue } from "../../application/skill/edit-skill-files";
import { PLATFORM_ORG_ID, toOrgId } from "../../domain/org-id";
type Version = { id: string; org_id: string; semantic_label: string; content_digest: string; created_at: Date | string; manifest: unknown };
export class PgSkillFileEditRepository implements SkillFileEditRepository {
  constructor(private readonly db: DatabasePort) {}
  async read(input: Parameters<SkillFileEditRepository["read"]>[0]): Promise<SkillFileSnapshotValue | null> {
    return this.db.withTenant(toOrgId(input.orgId), async session => {
      const version = (await session.query<Version>(`SELECT id, org_id, semantic_label, content_digest, created_at, manifest FROM skill_versions
        WHERE id=$1 AND skill_id=$2 AND (org_id=$3 OR org_id=$4) AND published=true`,
      [input.versionId, input.skillId, input.orgId, PLATFORM_ORG_ID])).rows[0];
      if (!version) return null;
      const rows = (await session.query<{ path: string; content: Buffer; media_type: string; digest: string }>(
        "SELECT path,content,media_type,digest FROM skill_version_files WHERE version_id=$1 AND org_id=$2 ORDER BY path", [version.id, version.org_id])).rows;
      // Database collation must not change the canonical order returned by save.
      const files = rows.map(row => {
        const bytes = Buffer.from(row.content);
        if (createHash("sha256").update(bytes).digest("hex") !== row.digest) throw new SkillFileEditError("DEPENDENCY_UNAVAILABLE");
        return { path: row.path, contentBase64: bytes.toString("base64"), mediaType: row.media_type, digest: row.digest, sizeBytes: bytes.length };
      }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      return SkillFileSnapshot.parse({ skillId: input.skillId, versionId: version.id, semanticLabel: version.semantic_label,
        contentDigest: version.content_digest, createdAt: new Date(version.created_at).toISOString(), readOnly: version.org_id === PLATFORM_ORG_ID, files });
    });
  }
  async append(input: Parameters<SkillFileEditRepository["append"]>[0]): ReturnType<SkillFileEditRepository["append"]> {
    return this.db.withTenant(toOrgId(input.orgId), async session => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [input.skillId]);
      const current = (await session.query<Version>(`SELECT id,org_id,semantic_label,content_digest,created_at,manifest FROM skill_versions
        WHERE org_id=$1 AND skill_id=$2 AND published=true ORDER BY created_at DESC LIMIT 1`, [input.orgId, input.skillId])).rows[0];
      if (!current) return { kind: "not-found" as const };
      if (current.id !== input.expectedVersionId) return { kind: "conflict" as const, currentVersionId: current.id };
      const count = (await session.query<{ count: string }>("SELECT count(*)::text AS count FROM skill_versions WHERE org_id=$1 AND skill_id=$2", [input.orgId, input.skillId])).rows[0];
      const versionId = `sv_${randomUUID()}`, semanticLabel = `v${Number(count?.count ?? 0) + 1}`;
      // Strictly advance the existing created_at-based head ordering even within one millisecond.
      const createdAt = new Date(Math.max(Date.now(), new Date(current.created_at).getTime() + 1)).toISOString();
      await session.query(`INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,false)`, [versionId, input.orgId, input.skillId, semanticLabel, input.contentDigest, JSON.stringify(current.manifest), input.actorId, createdAt]);
      for (const file of input.files) await session.query(`INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest)
        VALUES($1,$2,$3,$4,$5,$6)`, [input.orgId, versionId, file.path, Buffer.from(file.contentBase64, "base64"), file.mediaType, file.digest]);
      await session.query("SELECT wave2_publish_skill_version($1,$2)", [input.orgId, versionId]);
      return { kind: "ok" as const, snapshot: SkillFileSnapshot.parse({ skillId: input.skillId, versionId, semanticLabel,
        contentDigest: input.contentDigest, createdAt, readOnly: false, files: input.files }) };
    });
  }
}
