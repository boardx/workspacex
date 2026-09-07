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
 * ## G1（2026-08-14，人类实测："导入失败：http_500"）—— `IMPORT_NAME_CONFLICT` 声明了但从未真正抛出过
 *
 * `url-import-draft.ts` 的 `ImportSkillFromUrlFailure` 联合类型里一直就有
 * `IMPORT_NAME_CONFLICT`，`skill-url-import.controller.ts` 也早就把它映射到 409——
 * 但**没有任何代码真的抛出它**。`skills` 表有 `skills_name_casefold_uniq`
 * （`org_id, lower(name)`）这条真实唯一约束（`wave2_skill_starter_import` 迁移），
 * 声明式契约那条姊妹路径（`pg-skill-contract-repository.ts` 的 `SkillDraftStorePort`）
 * 早就在 `catch (isUniqueViolation(error))` 里把它翻成 `SkillNameConflictError`，
 * 这条 URL 导入路径漏了同一步：下面 `INSERT INTO skills` 撞到重名时，原始的
 * Postgres `23505` 一路裸奔到 `skill-url-import.controller.ts` 的 `catch` 块——
 * 那里只认 `ImportSkillFromUrlError` 与 `ImportSourceRefusedError` 两种类型，
 * 其余一律 `throw error`，NestJS 的默认异常过滤器把它变成一个**没有 reasonCode**
 * 的裸 500。前端 `ApiError` 在没有 reasonCode 时把 `message` 缺省成 `` `http_${status}` ``
 * （`lib/api-client.ts`），这正是人类看到的「导入失败：http_500」的完整机制——
 * 不是 SSRF 门误杀，也不是目录 URL 单独的问题，是**这一条错误翻译从来没接上**。
 * 修法：`persist` 捕获这条唯一约束冲突，抛出与声明式路径同一个 `SkillNameConflictError`
 * （`application/skill/ports.ts`），由用例层（`import-skill-from-url.ts`）接住翻成
 * `ImportSkillFromUrlError("IMPORT_NAME_CONFLICT")`——与已经存在的 409 映射对上。
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
import { PLATFORM_ORG_ID, toOrgId } from "../../domain/org-id";
import type {
  SkillUrlImportRepository,
} from "../../application/skill-import/import-skill-from-url";
import type { ImportSkillFromUrlResult } from "../../application/skill-import/url-import-draft";
import { SkillNameConflictError } from "../../application/skill/ports";

interface ImportRow {
  readonly skill_id: string;
  readonly version_id: string;
  readonly content_digest: string;
}

interface PathRow {
  readonly path: string;
}

/** 唯一约束冲突。23505 = unique_violation。与 `pg-skill-contract-repository.ts` 同一判定。 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * `stable_name` 撞的是不是 `skills_stable_name_uniq`（`org_id, stable_name`）这条——
 * 与撞 `skills_name_casefold_uniq`（`org_id, lower(name)`）是两种不同的冲突，前者不该
 * 翻成 `SkillNameConflictError`（那会让用户看到「名字重复」但他填的名字其实没有重复，
 * 只是自动生成的 `stable_name` 撞了）。pg 驱动在唯一约束冲突时把约束名放在
 * `error.constraint` 上。
 */
function isStableNameUniqueViolation(error: unknown): boolean {
  return (
    isUniqueViolation(error)
    && (error as { constraint?: string }).constraint === "skills_stable_name_uniq"
  );
}

/**
 * 声明式创建路径（starter pack）的 `stable_name` 来自 pack manifest（人类写的
 * `pdf-create` 这种 slug）。URL 导入没有 manifest，此前直接拿内部 id `sk_<uuid>`
 * 当 `stable_name`（G2，2026-09-07 人类实测：chat 阶段文案「正在执行技能脚本
 * （sk_c8b0b9a3-...）」把内部 id 原样展示给用户——`agent-run-phase.ts` 的既有纪律是
 * 「原样回显 `skill_stable_name`，不额外维护第二张翻译表」，这条纪律成立的前提是
 * `stable_name` 本身就是人类可读的，URL 导入这条路径破坏了这个前提）。
 * 这里从 `input.name`（用户在导入时填的展示名）派生一个可读 slug，而不是引入
 * 第二份「id → 可读名」映射——修的是 `stable_name` 的生成来源，不是它的展示方式。
 */
function slugifyForStableName(name: string): string {
  const trimmed = name.trim();
  // 含非 ASCII 字符（中文/日文/其他语言）时不做音译——音译会削掉大部分信息
  // （"AI 转型洞察报告" 音译只剩 "ai"，反而比原名更不可读），保留原文、只把空白
  // 折成连字符：用户自己填的名字本身就是「人类可读」，不需要被翻译成拼音，
  // 见文件头 G2「用户填的名字才是人类可读，id 从来不是」。
  // eslint-disable-next-line no-control-regex -- 判定"是否纯 ASCII"需要这个范围。
  if (!/^[\x00-\x7F]*$/.test(trimmed)) return trimmed.replace(/\s+/g, "-");
  const ascii = trimmed
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii === "" ? trimmed : ascii;
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

      // ⚠ `skills_name_casefold_uniq`/`capability_listings_uniq` 都是 `(org_id, ...)`
      // 维度，只在同一个组织内互撞——对着平台组织（`org-platform`）的四个官方 skill
      // 永远不会触发，下面 `INSERT` 撞的唯一约束例外只吃得住"同组织重名"这一种情况。
      // 而 `listAll()`（`GET /skills`，chat `#` 挂载池 + `/skill` 目录都读这条）对每个
      // 组织都会把平台行 `OR org_id = PLATFORM_ORG_ID` 拼进结果、不做任何去重——组织
      // 悄悄导入一个和平台官方 skill 同名的 skill，两条会同时出现、都能被独立挂载。
      // 这里显式把平台组织也纳入冲突判定，堵住这条此前漏掉的同名重复来源。
      const platformConflict = await session.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM skills WHERE org_id = $1 AND lower(name) = lower($2)
           UNION ALL
           SELECT 1 FROM capability_listings
            WHERE org_id = $1 AND kind = 'skill' AND lower(name) = lower($2)
         ) AS present`,
        [PLATFORM_ORG_ID, input.name],
      );
      if (platformConflict.rows[0]?.present) throw new SkillNameConflictError(input.name);

      // 见上面 `slugifyForStableName` 的文件头 G2：`stable_name` 从展示名派生，不是
      // 内部 id。并发/重名场景下同一个组织可能已经有相同的 slug——advisory lock 只
      // 保证同组织导入串行，挡不住"上周已经导入过同名 skill"这种历史冲突，所以插入
      // 撞 `skills_stable_name_uniq` 时追加数字后缀重试，而不是让内部 id 兜底。
      //
      // ⚠ SAVEPOINT，不是裸 try/catch：PostgreSQL 里一次约束冲突会把**整个事务**
      //   置为 aborted，重试同一事务里的下一条 INSERT 会直接拿到
      //   "current transaction is aborted" ——与 `pg-invite-link-repository.ts`
      //   `try_insert_link` 同一个坑、同一个修法。
      const baseStableName = slugifyForStableName(input.name);
      let stableName = baseStableName;
      let attempt = 1;
      // 20 次都撞说明该组织真有大量同名/同 slug 的 skill——退到"slug + skillId 后缀"
      // 保证收敛，同时仍然是从用户填的名字派生的、不是裸 id。
      const MAX_SUFFIX_ATTEMPTS = 20;
      for (;;) {
        await session.query("SAVEPOINT try_insert_skill");
        try {
          await session.query(
            `INSERT INTO skills
               (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
            [skillId, input.orgId, stableName, input.name, input.actorId, now],
          );
          break;
        } catch (error) {
          await session.query("ROLLBACK TO SAVEPOINT try_insert_skill");
          if (isStableNameUniqueViolation(error)) {
            attempt += 1;
            stableName = attempt > MAX_SUFFIX_ATTEMPTS
              ? `${baseStableName}-${skillId}`
              : `${baseStableName}-${attempt}`;
            continue;
          }
          // `skills_name_casefold_uniq`（org_id, lower(name)）撞了：同组织已有同名
          // skill（不分大小写）。翻成与声明式创建路径同一个错误类型，见文件头
          // G1 长注。
          if (isUniqueViolation(error)) throw new SkillNameConflictError(input.name);
          throw error;
        }
      }
      await session.query("RELEASE SAVEPOINT try_insert_skill");
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
