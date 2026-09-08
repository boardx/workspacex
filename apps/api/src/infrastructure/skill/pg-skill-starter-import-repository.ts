import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ExistingImportOutcome,
  PersistVerifiedImportOutcome,
  SkillStarterImportRepository,
  SkillStarterImportResult,
} from "../../application/skill-import/ports";
import { skillContentDigest } from "../../domain/skill/starter-pack";
import { PLATFORM_ORG_ID } from "../../domain/org-id";

interface ImportRow {
  status: "pending" | "succeeded" | "failed";
  payload_digest: string;
  result_json: SkillStarterImportResult | null;
  failure_code: string | null;
}

async function findImport(
  session: TenantSession,
  orgId: string,
  idempotencyKey: string,
): Promise<ImportRow | null> {
  const found = await session.query<ImportRow>(
    `SELECT status, payload_digest, result_json, failure_code
       FROM starter_pack_imports
      WHERE org_id = $1 AND idempotency_key = $2`,
    [orgId, idempotencyKey],
  );
  return found.rows[0] ?? null;
}

function existingOutcome(
  existing: ImportRow,
  payloadDigest: string,
): Exclude<ExistingImportOutcome, { readonly kind: "missing" }> {
  if (existing.payload_digest !== payloadDigest) return { kind: "idempotency-conflict" };
  if (existing.status === "succeeded" && existing.result_json) {
    return { kind: "replayed", result: existing.result_json };
  }
  return { kind: "previous-failure", failureCode: existing.failure_code ?? "SKILL_STARTER_PACK_INVALID" };
}

export class PgSkillStarterImportRepository implements SkillStarterImportRepository {
  constructor(private readonly db: DatabasePort) {}

  async findExisting(input: Parameters<SkillStarterImportRepository["findExisting"]>[0]) {
    return this.db.withTenant(input.orgId, async (session): Promise<ExistingImportOutcome> => {
      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (!existing) return { kind: "missing" };
      return existingOutcome(existing, input.payloadDigest);
    });
  }

  async persistVerified(input: Parameters<SkillStarterImportRepository["persistVerified"]>[0]) {
    return this.db.withTenant(input.orgId, async (session): Promise<PersistVerifiedImportOutcome> => {
      // Serialize imports per organization. This closes the race between conflict detection
      // and inserts without blocking unrelated tenants.
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);

      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (existing) return existingOutcome(existing, input.payloadDigest);

      const importId = `skill-import-${randomUUID()}`;
      const importedAt = new Date().toISOString();
      await session.query(
        `INSERT INTO starter_pack_imports
          (id, org_id, pack_id, pack_version, pack_digest, payload_digest, idempotency_key,
           administrator_id, imported_at, status, result_json, failure_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL,NULL)`,
        [
          importId,
          input.orgId,
          input.pack.packId,
          input.pack.packVersion,
          input.pack.packDigest,
          input.payloadDigest,
          input.idempotencyKey,
          input.actorId,
          importedAt,
        ],
      );

      const stableNames = input.pack.skills.map((skill) => skill.stableName);
      const names = input.pack.skills.map((skill) => skill.name.toLocaleLowerCase());

      /**
       * 同一个 `stable_name` 的**新版本**是升级，不是重名冲突。
       *
       * ## 事故形态（issue：标准包无升级路径）
       *
       * `ensureStandardSkillPacksSeeded` 的幂等键是
       * `platform-builtin:<packId>:<packVersion>`——**版本在键里**。所以把某个包
       * 的发货版本 bump 一格，键就变成新的，`findExisting` 返回 `missing`，走的是
       * **完整导入**路径；而完整导入此前只会 `INSERT INTO skills`，于是撞上
       * `stable_name` 冲突检查 ⇒ `name-conflict` ⇒ `SkillStarterPackConflictError`。
       *
       * 真实 Postgres 实测（先按 1.1.1 种一轮，再把 `standard-web` bump 到 1.1.2
       * 重跑同一个库）：
       *   · `starter_pack_imports` 多出一行
       *     `platform-builtin:standard-web:1.1.2 / failed / SKILL_STARTER_PACK_CONFLICT`；
       *   · `web-artifact` 的 SKILL.md 仍是旧正文（3384 字节、`semantic_label=1.0.1`），
       *     新版那 5439 字节一个也没落库。
       *
       * 也就是说：**发货内容改了，组织永远拿不到**。与 `ensurePlatformSkillsSeeded`
       * 头注里那个「只在不存在时创建」的坑同源——对**内容会变的东西**，这种幂等
       * 把「没更新」伪装成「已经是最新」。
       *
       * ## 判据：升级目标 = 本 org 名下同 `stable_name` 的既有 skill 行
       *
       * 只认 `org_id = input.orgId` 自己的行。平台组织（`PLATFORM_ORG_ID`）的行对
       * 每个 org 可见但**不属于**它，别的 org 写不了，也不该被当成升级目标——那种
       * 情况仍然是货真价实的重名冲突，下面的检查照旧挡住。
       */
      const upgradeRows = await session.query<{ id: string; stable_name: string; name: string }>(
        `SELECT id, stable_name, name FROM skills
          WHERE org_id = $1 AND stable_name = ANY($2::text[])
          FOR UPDATE`,
        [input.orgId, stableNames],
      );
      const upgradeTargets = new Map(upgradeRows.rows.map((row) => [row.stable_name, row]));
      const upgradeIds = upgradeRows.rows.map((row) => row.id);

      // ⚠ 同时对着 `PLATFORM_ORG_ID` 查——四个官方 skill（`skill-platform-*`）在
      // `listAll()`/`GET /skills` 里对每个组织都可见（design-delta `platform-owned-skills`
      // 的 `OR org_id = PLATFORM_ORG_ID` 兜底），但这条冲突检查此前只查了 `org_id = $1`
      // 自己。两条唯一约束（`skills_name_casefold_uniq`/`capability_listings_uniq`）也都是
      // `(org_id, ...)` 维度，永远不会因为撞了平台行而失败——组织能悄悄导入一个和平台
      // 官方 skill 同名的 skill，`GET /skills` 把两条拼在一起返回、互不去重，chat 的
      // `#` 挂载列表与 `/skill` 目录里就会看到同一个名字出现两次，且都能被独立挂载。
      // 这里把平台组织也纳入冲突判定，从源头挡住这种新的同名重复。
      //
      // `id <> ALL($5)` 是升级路径唯一放宽的地方：**升级目标自己那几行**不算冲突。
      // 它精确到行 id，不是把整条检查改宽——任何**别的** skill 撞了 stable_name 或
      // 显示名（含平台组织那几行、含本 org 里同名的另一个 skill），照样判冲突。
      // `capability_listings` 侧同样按 id 排除：pack 导入时两张表写的是同一个 id
      // （见下方 `INSERT INTO capability_listings ... VALUES ($1` 用的就是 skillId）。
      const conflicts = await session.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM skills
            WHERE (org_id = $1 OR org_id = $4)
              AND (stable_name = ANY($2::text[]) OR lower(name) = ANY($3::text[]))
              AND id <> ALL($5::text[])
           UNION ALL
           SELECT 1 FROM capability_listings
            WHERE (org_id = $1 OR org_id = $4) AND kind = 'skill' AND lower(name) = ANY($3::text[])
              AND id <> ALL($5::text[])
         ) AS present`,
        [input.orgId, stableNames, names, PLATFORM_ORG_ID, upgradeIds],
      );
      if (conflicts.rows[0]?.present) {
        await session.query(
          `UPDATE starter_pack_imports
              SET status = 'failed', failure_code = 'SKILL_STARTER_PACK_CONFLICT'
            WHERE id = $1 AND org_id = $2`,
          [importId, input.orgId],
        );
        return { kind: "name-conflict" };
      }

      const skillIds: string[] = [];
      const versionIds: string[] = [];
      for (const skill of input.pack.skills) {
        const existingSkill = upgradeTargets.get(skill.stableName);
        const digest = skillContentDigest(skill);

        if (existingSkill) {
          /**
           * 升级路径。三件事，顺序是语义的一部分：
           *
           * ① **正文没变就什么都不做**——`content_digest` 命中一条已发布版本时复用
           *    它的 id。否则每跑一次种子就堆一个新版本，且会去 publish 一个已发布的
           *    版本而报错。这条同时是 ② 的反证方向：实现若退回「只在不存在时创建」，
           *    ② 会红；若变成「每次都插新版本」，① 会红，两条互相夹住。
           * ② **正文变了就发一个新版本**——历史版本一行都不动（`skill_versions` 的
           *    `skill_versions_immutable_trg` 在 `published` 时挡掉 UPDATE/DELETE，
           *    想改也改不了）。`listAll()` 取的是「最新一条 published」，新版本落库
           *    即自动成为生效版本，没有第二个指针要维护。
           * ③ 显示名跟着发货内容走（`skills.name` 与 `capability_listings.name`
           *    两张投影表一起改，不留下一张说旧名字的表）。
           */
          const reusable = await session.query<{ id: string }>(
            `SELECT id FROM skill_versions
              WHERE org_id = $1 AND skill_id = $2 AND content_digest = $3 AND published
              ORDER BY created_at DESC, id DESC LIMIT 1`,
            [input.orgId, existingSkill.id, digest],
          );
          const reusableId = reusable.rows[0]?.id;
          skillIds.push(existingSkill.id);

          if (reusableId !== undefined) {
            versionIds.push(reusableId);
            continue;
          }

          /**
           * `skill_versions_semantic_uniq (org_id, skill_id, semantic_label)` 是一条
           * 诚实的约束：同一个语义版本号不能指向两份不同的正文。发货包若改了正文却
           * 忘了 bump 该 skill 自己的 `semanticVersion`，这里必须**明确报出来**，
           * 而不是让它变成一条谁都看不懂的 23505。
           */
          const labelTaken = await session.query<{ present: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM skill_versions
                WHERE org_id = $1 AND skill_id = $2 AND semantic_label = $3
             ) AS present`,
            [input.orgId, existingSkill.id, skill.semanticVersion],
          );
          if (labelTaken.rows[0]?.present) {
            await session.query(
              `UPDATE starter_pack_imports
                  SET status = 'failed', failure_code = 'SKILL_STARTER_PACK_VERSION_LABEL_REUSED'
                WHERE id = $1 AND org_id = $2`,
              [importId, input.orgId],
            );
            return { kind: "version-label-reused", stableName: skill.stableName, semanticVersion: skill.semanticVersion };
          }

          const upgradeVersionId = `skill-version-${randomUUID()}`;
          versionIds.push(upgradeVersionId);
          await session.query(
            `INSERT INTO skill_versions
              (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
               created_at, published)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,false)`,
            [
              upgradeVersionId,
              input.orgId,
              existingSkill.id,
              skill.semanticVersion,
              digest,
              JSON.stringify(skill.manifest),
              input.actorId,
              importedAt,
            ],
          );
          for (const file of skill.files) {
            await session.query(
              `INSERT INTO skill_version_files
                (org_id, version_id, path, content, media_type, digest)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                input.orgId,
                upgradeVersionId,
                file.path,
                Buffer.from(file.contentBase64, "base64"),
                file.mediaType,
                file.digest,
              ],
            );
          }
          await session.query("SELECT wave2_publish_skill_version($1, $2)", [input.orgId, upgradeVersionId]);

          if (existingSkill.name !== skill.name) {
            await session.query(
              `UPDATE skills SET name = $3, updated_at = $4 WHERE id = $1 AND org_id = $2`,
              [existingSkill.id, input.orgId, skill.name, importedAt],
            );
            await session.query(
              `UPDATE capability_listings SET name = $3
                WHERE id = $1 AND org_id = $2 AND kind = 'skill'`,
              [existingSkill.id, input.orgId, skill.name],
            );
          }
          continue;
        }

        const skillId = `skill-${randomUUID()}`;
        const versionId = `skill-version-${randomUUID()}`;
        skillIds.push(skillId);
        versionIds.push(versionId);

        await session.query(
          `INSERT INTO skills
            (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6)`,
          [skillId, input.orgId, skill.stableName, skill.name, input.actorId, importedAt],
        );
        await session.query(
          `INSERT INTO skill_versions
            (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id,
             created_at, published)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,false)`,
          [
            versionId,
            input.orgId,
            skillId,
            skill.semanticVersion,
            digest,
            JSON.stringify(skill.manifest),
            input.actorId,
            importedAt,
          ],
        );
        for (const file of skill.files) {
          await session.query(
            `INSERT INTO skill_version_files
              (org_id, version_id, path, content, media_type, digest)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              input.orgId,
              versionId,
              file.path,
              Buffer.from(file.contentBase64, "base64"),
              file.mediaType,
              file.digest,
            ],
          );
        }
        await session.query("SELECT wave2_publish_skill_version($1, $2)", [input.orgId, versionId]);

        // `capability_listings` is the signed Wave 1 directory projection. It is created in
        // the same transaction so the UI can never see a Skill definition without its row,
        // or a selectable row whose immutable definition rolled back.
        await session.query(
          `INSERT INTO capability_listings
            (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
           VALUES ($1,$2,'skill',$3,'org-wide',NULL,true,NULL)`,
          [skillId, input.orgId, skill.name],
        );
      }

      const result: SkillStarterImportResult = {
        importId,
        packId: input.pack.packId,
        packVersion: input.pack.packVersion,
        packDigest: input.pack.packDigest,
        status: "succeeded",
        skillIds,
        versionIds,
        importedAt,
      };
      await session.query(
        `UPDATE starter_pack_imports
            SET status = 'succeeded', result_json = $3::jsonb, failure_code = NULL
          WHERE id = $1 AND org_id = $2`,
        [importId, input.orgId, JSON.stringify(result)],
      );
      return { kind: "created", result };
    });
  }

  async recordFailure(input: Parameters<SkillStarterImportRepository["recordFailure"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);
      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (existing) {
        return existingOutcome(existing, input.payloadDigest);
      }
      await session.query(
        `INSERT INTO starter_pack_imports
          (id, org_id, pack_id, pack_version, pack_digest, payload_digest, idempotency_key,
           administrator_id, imported_at, status, result_json, failure_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',NULL,$10)`,
        [
          `skill-import-${randomUUID()}`,
          input.orgId,
          input.packId,
          input.packVersion,
          input.packDigest,
          input.payloadDigest,
          input.idempotencyKey,
          input.actorId,
          new Date().toISOString(),
          input.failureCode,
        ],
      );
      return { kind: "previous-failure" as const, failureCode: input.failureCode };
    });
  }
}
