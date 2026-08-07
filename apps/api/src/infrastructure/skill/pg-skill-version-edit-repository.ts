/**
 * #595 后台管理面最小闭环 —— 编辑落**模型 A**（同 `pg-skill-url-import-repository.ts`
 * 头注解释的那套：`skills`/`skill_versions`/`skill_version_files`，运行时唯一真读的那套）。
 *
 * ## 发布必须走 `wave2_publish_skill_version`
 *
 * 与 URL 导入同一条约束：`skill_versions` 只能以草稿落地（`starts_draft` 触发器），
 * 落地后不可改（`immutable` 触发器）。这里不 UPDATE `published`，唯一发布路径是
 * 那个 definer 函数，它自己校验租户。
 *
 * ## semantic_label 必须递增，不能沿用 `v1`
 *
 * `skill_versions_semantic_uniq UNIQUE(org_id, skill_id, semantic_label)` ——
 * 每次编辑都在同一 `skillId` 下追加一条新版本，标签必须与该 skill 已有的版本数
 * 错开，否则唯一约束会拒。用 `SELECT count(*)` 而不是维护一个游标字段：
 * 版本数本身就是下一个标签，不需要第二份计数状态。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  EditSkillVersionContentResult,
  SkillVersionEditRepository,
} from "../../application/skill/edit-skill-version-content";

interface SkillRow {
  readonly id: string;
}

interface CountRow {
  readonly count: string;
}

export class PgSkillVersionEditRepository implements SkillVersionEditRepository {
  constructor(private readonly db: DatabasePort) {}

  async persist(
    input: Parameters<SkillVersionEditRepository["persist"]>[0],
  ): Promise<{ kind: "ok"; result: EditSkillVersionContentResult } | { kind: "skill-not-found" }> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      /**
       * 与 URL 导入同一把锁：并发编辑同一个 skill 必须串行，否则两笔都读到同一个
       * `count(*)`、都算出同一个 `semantic_label`，唯一约束只能拦住其中一笔。
       */
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.skillId]);

      const found = await session.query<SkillRow>(
        `SELECT id FROM skills WHERE id = $1 AND org_id = $2`,
        [input.skillId, input.orgId],
      );
      if (found.rows[0] === undefined) {
        return { kind: "skill-not-found" as const };
      }

      const counted = await session.query<CountRow>(
        `SELECT count(*)::text AS count FROM skill_versions WHERE skill_id = $1 AND org_id = $2`,
        [input.skillId, input.orgId],
      );
      const semanticLabel = `v${Number(counted.rows[0]?.count ?? "0") + 1}`;

      const versionId = `sv_${randomUUID()}`;
      const now = new Date().toISOString();

      await session.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
            created_at, published)
         VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,false)`,
        [versionId, input.orgId, input.skillId, semanticLabel, input.contentDigest, input.actorId, now],
      );
      await session.query(
        `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
         VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4)`,
        [input.orgId, versionId, Buffer.from(input.content, "utf8"), input.contentDigest],
      );
      // 见文件头：唯一合法的发布路径。
      await session.query("SELECT wave2_publish_skill_version($1, $2)", [input.orgId, versionId]);

      return {
        kind: "ok" as const,
        result: {
          skillId: input.skillId,
          versionId,
          semanticLabel,
          contentDigest: input.contentDigest,
          createdAt: now,
        },
      };
    });
  }
}
