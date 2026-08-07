/**
 * #595 段 2 —— URL 导入的持久化，落**模型 A**。
 *
 * ## 落哪三张表，以及为什么不是另开一套
 *
 * `skills` / `skill_versions` / `skill_version_files` —— **运行时唯一真读的那套**
 * （`pg-agent-run-repository.ts` 的 `FROM skill_version_files`）。
 * ⚠ 后台今天编辑的 `skill_contracts` 是**另一套、且运行时不读**，这正是
 *   「chat 里全是种子/mock」的机制性原因。A/B 不收敛登记在 **#598**，本轮不收敛。
 *
 * ## 发布必须走 `wave2_publish_skill_version`
 *
 * `skill_versions` 上有 `starts_draft` 与 `immutable` 两个触发器：新版本只能以草稿
 * 落地，且落地后不可改。**唯一**能把它转成已发布的路径是那个 definer 函数，
 * 而它自己会校验租户（`Skill version publish is outside the writable tenant`）。
 * ⇒ 这里不 UPDATE `published`，也不该有第二条发布路径。
 *
 * ## ⚠ 路径判定不在这一层
 *
 * 文件路径已在用例层过 `normalizedPath`（域层单一事实源）。这里**不再判一次**，
 * 因为第二处判定就是下一次分叉的来源——#595 刚实测到 `normalizedPath` 与 DB CHECK
 * 分叉过两条。DB 侧的 `skill_version_files_normal_path` CHECK 是**机械兜底**，
 * 不是第二份定义：两者一旦不同义，DB 拒掉应用层放行的行，而不是反过来。
 *
 * ## `capability_listings`（2026-08-07 补，人类实测："我在后台不能看到导入了的 skills"）
 *
 * 后台「Skill 目录」页（`/admin/skill`）读的是 `GET /capabilities?kind=skill`，那是
 * `capability_listings` 表的投影——**不是** `GET /skills`（`skill_contracts`/`skills`
 * 合并读那条，见 #689 的修复）。这里此前从未写这张表：URL 导入能建出一个真实可执行
 * 的 skill（agent 运行时读的正是 `skills`/`skill_versions`），却在后台 UI 唯一读的
 * 目录表里永远不存在一行——这才是那句人类原话背后的真实机制，`pg-skill-starter-import
 * -repository.ts` 早就有这一行（"the same transaction so the UI can never see a Skill
 * definition without its row"），URL 导入这条姊妹路径漏了同一步。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  SkillUrlImportRepository,
} from "../../application/skill-import/import-skill-from-url";
import type { ImportSkillFromUrlResult } from "../../application/skill-import/url-import-draft";

interface ImportRow {
  readonly skill_id: string;
  readonly version_id: string;
  readonly content_digest: string;
}

interface PathRow {
  readonly path: string;
}

export class PgSkillUrlImportRepository implements SkillUrlImportRepository {
  constructor(private readonly db: DatabasePort) {}

  async findByIdempotencyKey(
    input: Parameters<SkillUrlImportRepository["findByIdempotencyKey"]>[0],
  ): Promise<ImportSkillFromUrlResult | null> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const found = await session.query<ImportRow>(
        `SELECT skill_id, version_id, content_digest
           FROM skill_url_imports
          WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      const paths = await session.query<PathRow>(
        `SELECT path FROM skill_version_files
          WHERE org_id = $1 AND version_id = $2 ORDER BY path`,
        [input.orgId, row.version_id],
      );
      return {
        skillId: row.skill_id,
        versionId: row.version_id,
        filePaths: paths.rows.map((p) => p.path),
        contentDigest: row.content_digest,
        // ⚠ 由用例层置 true —— 「这次是回放」是调用语境，不是行里的事实。
        replayed: false,
      };
    });
  }

  async persist(
    input: Parameters<SkillUrlImportRepository["persist"]>[0],
  ): Promise<ImportSkillFromUrlResult> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      /**
       * 与 starter-pack 导入同一把锁：并发的同组织导入必须串行，
       * 否则两笔都查不到对方、都插入，唯一约束只能拦住其中一笔而另一笔已建了 skill。
       */
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);

      const replay = await session.query<ImportRow>(
        `SELECT skill_id, version_id, content_digest
           FROM skill_url_imports
          WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) {
        const paths = await session.query<PathRow>(
          `SELECT path FROM skill_version_files
            WHERE org_id = $1 AND version_id = $2 ORDER BY path`,
          [input.orgId, existing.version_id],
        );
        return {
          skillId: existing.skill_id,
          versionId: existing.version_id,
          filePaths: paths.rows.map((p) => p.path),
          contentDigest: existing.content_digest,
          replayed: true,
        };
      }

      const skillId = `sk_${randomUUID()}`;
      const versionId = `sv_${randomUUID()}`;
      const now = new Date().toISOString();

      await session.query(
        `INSERT INTO skills
           (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
        [skillId, input.orgId, skillId, input.name, input.actorId, now],
      );
      await session.query(
        `INSERT INTO skill_versions
           (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
            created_at, published)
         VALUES ($1,$2,$3,'v1',$4,$5::jsonb,$6,$7,false)`,
        [
          versionId,
          input.orgId,
          skillId,
          input.contentDigest,
          JSON.stringify({ sourceUrl: input.sourceUrl }),
          input.actorId,
          now,
        ],
      );
      for (const file of input.files) {
        await session.query(
          `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [input.orgId, versionId, file.path, file.content, file.mediaType, file.digest],
        );
      }
      // 见文件头：唯一合法的发布路径。
      await session.query("SELECT wave2_publish_skill_version($1, $2)", [input.orgId, versionId]);

      // 见文件头 2026-08-07 补注：同一事务里补上目录行——`pg-skill-starter-import
      // -repository.ts` 早就有这一步，这是它的姊妹路径，此前漏写。UI 不可能看到
      // 「有定义没目录行」，也不可能看到目录里有一行但其定义因故回滚。
      await session.query(
        `INSERT INTO capability_listings
           (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
         VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)`,
        [skillId, input.orgId, input.name],
      );

      await session.query(
        `INSERT INTO skill_url_imports
           (id, org_id, idempotency_key, source_url, content_digest, skill_id, version_id,
            actor_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          `imp_${randomUUID()}`,
          input.orgId,
          input.idempotencyKey,
          input.sourceUrl,
          input.contentDigest,
          skillId,
          versionId,
          input.actorId,
          now,
        ],
      );

      return {
        skillId,
        versionId,
        filePaths: input.files.map((f) => f.path),
        contentDigest: input.contentDigest,
        replayed: false,
      };
    });
  }
}
