import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ExistingImportOutcome,
  PersistVerifiedImportOutcome,
  SkillStarterImportRepository,
  SkillStarterImportResult,
} from "../../application/skill-import/ports";
import type { WorkSkillManifest } from "@repo/contracts/work-skill-meta";
import { skillContentDigest, type SkillStarterPack } from "../../domain/skill/starter-pack";
import { PLATFORM_ORG_ID } from "../../domain/org-id";

/** `skill_gate_records.written_by`：导入时的门判定不是任何人的手工回写（I-9）。 */
export const IMPORT_GATE_WRITER = "system:starter-pack-import";

interface ImportRow {
  id: string;
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
    `SELECT id, status, payload_digest, result_json, failure_code
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

/**
 * 幂等约定：只有**成功**是终局，同键重试原样重放首次结果。失败只留 provenance、不是终局——
 * 请求体只有 `{packId, packVersion, idempotencyKey}`，所有失败原因（pack 根目录没配、包文件缺失/
 * 不合规、与已有 skill 冲突）都取决于**服务端**的配置与状态，而不是请求本身；把它们当终局缓存，
 * 运维修好配置后同一个键永远重放旧失败（实测：`SKILL_STARTER_PACK_ROOT` 未配置 → 404，配好后
 * 同键重试仍 404）。同键不同 payload 仍是 idempotency 冲突。
 */
function isRetryableFailure(existing: ImportRow, payloadDigest: string): boolean {
  return existing.status === "failed" && existing.payload_digest === payloadDigest;
}

/**
 * WS02 `skill_catalog_entries` 的写路径（Phase 20 WS02，UC-2 / R3.4）。
 *
 * 只在 starter-pack 导入事务内调用（传入的 session 就是那个事务）：
 *   · 新行 `channel = 'candidate'`；
 *   · 已有行只刷新检索字段（stable_id / domain / search_document / updated_*），**不回退通道**（I-8）。
 * `skill_versions.manifest.work` 的写入形状也在这里（不改表结构，只是 manifest 的子键，ADR-117 #2）。
 */

function versionManifestJson(
  skill: SkillStarterPack["skills"][number],
  workManifests: ReadonlyMap<string, WorkSkillManifest> | undefined,
): string {
  const work = workManifests?.get(skill.stableName);
  return JSON.stringify(work === undefined ? skill.manifest : { ...skill.manifest, work });
}

async function findStableIdConflict(
  session: TenantSession,
  input: { readonly orgId: string; readonly stableIds: readonly string[]; readonly ownSkillIds: readonly string[] },
): Promise<{ readonly stableId: string; readonly conflictingSkillId: string } | null> {
  if (input.stableIds.length === 0) return null;
  const found = await session.query<{ stable_id: string; skill_id: string }>(
    `SELECT stable_id, skill_id FROM skill_catalog_entries
      WHERE org_id = $1 AND stable_id = ANY($2::text[]) AND skill_id <> ALL($3::text[])
      ORDER BY stable_id LIMIT 1`,
    [input.orgId, [...input.stableIds], [...input.ownSkillIds]],
  );
  const row = found.rows[0];
  return row === undefined ? null : { stableId: row.stable_id, conflictingSkillId: row.skill_id };
}

async function upsertSkillCatalogEntries(
  session: TenantSession,
  input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly at: string;
    readonly skills: readonly {
      readonly skillId: string;
      readonly name: string;
      readonly description: unknown;
      readonly work: WorkSkillManifest | undefined;
    }[];
  },
): Promise<void> {
  for (const skill of input.skills) {
    if (skill.work === undefined) continue; // 普通 Skill 不进目录（A1）
    const description = typeof skill.description === "string" ? skill.description : "";
    const searchDocument = [skill.name, skill.work.stableId, skill.work.domain, description].join(" ");
    // 已有行只刷新检索字段、不回退通道；无行才插 candidate。整个导入持有 per-org advisory lock，
    // 所以「先 UPDATE、0 行再 INSERT」之间没有并发窗口。
    const refreshed = await session.query(
      `UPDATE skill_catalog_entries
          SET stable_id = $3, domain = $4, search_document = $5, updated_by = $6, updated_at = $7
        WHERE org_id = $1 AND skill_id = $2
        RETURNING skill_id`,
      [input.orgId, skill.skillId, skill.work.stableId, skill.work.domain, searchDocument, input.actorId, input.at],
    );
    if (refreshed.rows.length > 0) continue;
    await session.query(
      `INSERT INTO skill_catalog_entries
        (org_id, skill_id, stable_id, domain, channel, successor_skill_id, search_document,
         updated_by, updated_at)
       VALUES ($1,$2,$3,$4,'candidate',NULL,$5,$6,$7)`,
      [input.orgId, skill.skillId, skill.work.stableId, skill.work.domain, searchDocument, input.actorId, input.at],
    );
  }
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
      // 失败不是终局（见 `isRetryableFailure`）：同键同摘要的失败记录被这次重试**接管**——
      // 复用那一行（保留 id），状态回到 pending 重新判定；成功记录照旧重放。
      const retrying = existing !== null && isRetryableFailure(existing, input.payloadDigest);
      if (existing && !retrying) return existingOutcome(existing, input.payloadDigest);

      const importId = retrying ? existing.id : `skill-import-${randomUUID()}`;
      const importedAt = new Date().toISOString();
      if (retrying) {
        await session.query(
          `UPDATE starter_pack_imports
              SET status = 'pending', failure_code = NULL, result_json = NULL,
                  pack_digest = $3, administrator_id = $4, imported_at = $5
            WHERE id = $1 AND org_id = $2`,
          [importId, input.orgId, input.pack.packDigest, input.actorId, importedAt],
        );
      } else await session.query(
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
       * ## 判据：升级目标 = **这个包自己上一次装进去的那些 skill**
       *
       * 光看「本 org 同 `stable_name`」是**不够窄的**——那会把用户自建的、URL 导入的、
       * 以及**另一个包**里同名的 skill 一并当成升级目标，让 A 包的正文悄悄盖掉 B 包
       * （或用户自己写）的 skill。`tests/skills/explicit-starter-import.test.ts` 的
       * 「rejects a name conflict visibly and never overwrites user/imported content」
       * 守的正是这条：另一个 `conflicting-pack` 带着同名 skill 进来必须 409。
       * 我第一版就是按「同 org 同 stable_name」写的，被这条测试逐字抓住（expected 201 to be 409）。
       *
       * 所以判据取**血统**，不取名字：`starter_pack_imports` 里本 org、**同一个
       * `pack_id`**、`status='succeeded'` 的那几次导入，其 `result_json->'skillIds'`
       * 记着它们当初铸出来的 skill id——只有这些行才是「这个包的上一版」，才可以升级。
       *
       * 于是三件事同时成立：
       *   · `standard-web` 1.1.1 → 1.1.2：同一个 `pack_id`，升级；
       *   · 另一个包带同名 skill 进来：血统对不上，照旧 409；
       *   · 用户自建/URL 导入的同名 skill：从不出现在任何导入的 `skillIds` 里，照旧 409。
       *
       * 只认 `org_id = input.orgId` 自己的行。平台组织（`PLATFORM_ORG_ID`）的行对
       * 每个 org 可见但**不属于**它，别的 org 写不了，也不该被当成升级目标。
       */
      const upgradeRows = await session.query<{ id: string; stable_name: string; name: string }>(
        `SELECT s.id, s.stable_name, s.name FROM skills s
          WHERE s.org_id = $1 AND s.stable_name = ANY($2::text[])
            AND EXISTS (
              SELECT 1 FROM starter_pack_imports i
               WHERE i.org_id = $1 AND i.pack_id = $3 AND i.status = 'succeeded'
                 AND i.result_json -> 'skillIds' @> to_jsonb(s.id)
            )
          FOR UPDATE`,
        [input.orgId, stableNames, input.pack.packId],
      );
      const upgradeTargets = new Map(upgradeRows.rows.map((row) => [row.stable_name, row]));

      /**
       * **跨包共享**的同一个 skill（ADR-118：同一 stableName@version 只有一份内容）。
       *
       * 内容线 pack 故意共享实体：S063/S017/S157/S161 同在 work-product 与 work-research，
       * S010 同在 work-research 与 work-sales——两份副本逐字节相同（build 测试核对）。此前血统只认
       * 「同一个 pack_id」，于是先导 work-product 再导 work-research，共享的那几个 skill 撞上冲突检查
       * ⇒ 整包 409 SKILL_STARTER_PACK_CONFLICT，一个组织永远装不齐三条内容线。
       *
       * 判据比「同名」窄得多，三条同时成立才复用（不新建 skill / 版本，不改任何行）：
       *   · 那一行来自**另一个** starter-pack 的成功导入（血统，同 upgradeRows）——用户自建、URL 导入、
       *     平台组织的行都不在任何本 org 导入的 skillIds 里，照旧冲突；
       *   · 它有一个已发布版本的 `content_digest` **等于**本包这份的 digest——内容分叉（同名不同正文）
       *     照旧 409，A 包的正文不会悄悄盖掉 B 包的；
       *   · 显示名相同（名字也是内容的一部分）。
       */
      //
      // 平台组织（`PLATFORM_ORG_ID`）的标准包 skill 同理：它们对每个组织都可见（platform-owned-skills），
      // 组织再显式导入同一个标准包时，逐字相同的那几个就是「已经有了」——复用平台那一行，不另铸一份
      // （另铸就是下方冲突检查要挡的同名重复）。只限普通 skill：Work Skill 的目录行属于本组织，
      // 不能指向平台组织的 skill 行。
      const sharedCandidates = await session.query<{
        id: string; org_id: string; stable_name: string; name: string; version_id: string; content_digest: string;
      }>(
        `SELECT s.id, s.org_id, s.stable_name, s.name, v.id AS version_id, v.content_digest FROM skills s
           JOIN skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id AND v.published
          WHERE s.stable_name = ANY($2::text[]) AND s.id <> ALL($4::text[])
            AND (
              (s.org_id = $1 AND EXISTS (
                SELECT 1 FROM starter_pack_imports i
                 WHERE i.org_id = $1 AND i.pack_id <> $3 AND i.status = 'succeeded'
                   AND i.result_json -> 'skillIds' @> to_jsonb(s.id)
              ))
              OR (s.org_id = $5 AND s.status = 'enabled')
            )
          ORDER BY (s.org_id = $1) DESC, v.created_at DESC, v.id DESC`,
        [input.orgId, stableNames, input.pack.packId, upgradeRows.rows.map((row) => row.id), PLATFORM_ORG_ID],
      );
      const sharedTargets = new Map<string, { id: string; versionId: string }>();
      for (const skill of input.pack.skills) {
        if (upgradeTargets.has(skill.stableName)) continue;
        const digest = skillContentDigest(skill);
        const isWork = input.workManifests?.get(skill.stableName) !== undefined;
        const hit = sharedCandidates.rows.find(
          (row) => row.stable_name === skill.stableName && row.content_digest === digest && row.name === skill.name &&
            (row.org_id === input.orgId || !isWork),
        );
        if (hit) sharedTargets.set(skill.stableName, { id: hit.id, versionId: hit.version_id });
      }
      const upgradeIds = [...upgradeRows.rows.map((row) => row.id), ...[...sharedTargets.values()].map((t) => t.id)];

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

      // WS02（E2）：manifest 的 stableId 已属于本组织另一个 Skill 的目录行 ⇒ 在写任何 skill /
      // 版本行之前拒绝（此处返回会提交事务，所以必须早于第一条 INSERT）。升级目标自己不算冲突。
      const stableIdConflict = await findStableIdConflict(session, {
        orgId: input.orgId,
        stableIds: [...(input.workManifests?.values() ?? [])].map((work) => work.stableId),
        ownSkillIds: upgradeIds,
      });
      if (stableIdConflict) {
        await session.query(
          `UPDATE starter_pack_imports
              SET status = 'failed', failure_code = 'WORK_SKILL_STABLE_ID_CONFLICT'
            WHERE id = $1 AND org_id = $2`,
          [importId, input.orgId],
        );
        return { kind: "stable-id-conflict", ...stableIdConflict };
      }

      const skillIds: string[] = [];
      const versionIds: string[] = [];
      for (const skill of input.pack.skills) {
        const shared = sharedTargets.get(skill.stableName);
        if (shared) {
          // 跨包共享、内容相同：复用已有 skill 与版本（幂等），本包不另铸一份。
          skillIds.push(shared.id);
          versionIds.push(shared.versionId);
          continue;
        }
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

          // 被 `retireSuperseded` 下线过、这一版又重新发货的 stable_name：升级即复活
          // （issue #3733）。放在 ① 的早退之前——重新发货的正文往往一个字节没变。
          // 只认本包血统里的行（`upgradeRows` 就是按血统查的），不会把管理员手动停用的
          // 别家 skill 拉起来。
          await session.query(
            `UPDATE skills SET status = 'enabled', updated_at = $3
              WHERE id = $1 AND org_id = $2 AND status = 'disabled'`,
            [existingSkill.id, input.orgId, importedAt],
          );
          await session.query(
            `UPDATE capability_listings SET enabled = true
              WHERE id = $1 AND org_id = $2 AND kind = 'skill' AND enabled = false`,
            [existingSkill.id, input.orgId],
          );

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
              versionManifestJson(skill, input.workManifests),
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
            versionManifestJson(skill, input.workManifests),
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

      // WS02：目录行与版本行、skill 行同一事务（任一语句失败即整体回滚）。
      await upsertSkillCatalogEntries(session, {
        orgId: input.orgId,
        actorId: input.actorId,
        at: importedAt,
        skills: input.pack.skills.map((skill, index) => ({
          skillId: skillIds[index]!,
          name: skill.name,
          description: skill.manifest.description,
          work: input.workManifests?.get(skill.stableName),
        })),
      });

      // EV04：导入时的确定性门判定（只补不盖——该版本已有记录则保持，例如平台运营回写的完整评测）。
      // digest 不对应本次落库版本的判定一律丢弃（与 write-back 的 digest-mismatch 同一判据）。
      for (const [index, skill] of input.pack.skills.entries()) {
        const status = input.gateStatuses?.get(skill.stableName);
        if (!status || input.workManifests?.get(skill.stableName) === undefined) continue;
        if (status.subjectVersionDigest !== `sha256:${skillContentDigest(skill)}`) continue;
        await session.query(
          `INSERT INTO skill_gate_records
             (org_id, skill_id, skill_version_id, subject_version_digest, status, decided_at, written_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8)
           ON CONFLICT (org_id, skill_version_id) DO NOTHING`,
          [input.orgId, skillIds[index], versionIds[index], status.subjectVersionDigest, JSON.stringify(status),
            status.decidedAt, IMPORT_GATE_WRITER, importedAt],
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

  async retireSuperseded(input: Parameters<SkillStarterImportRepository["retireSuperseded"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);
      // 血统子查询与 `persistVerified` 里的 `upgradeRows` 逐字同构：只有本包自己上一次
      // 装进去的行才可能被下线。`keepStableNames` 是这一版仍在发货的全集。
      const retired = await session.query<{ id: string }>(
        `UPDATE skills s SET status = 'disabled', updated_at = now()
          WHERE s.org_id = $1 AND s.status = 'enabled'
            AND s.stable_name <> ALL($2::text[])
            AND EXISTS (
              SELECT 1 FROM starter_pack_imports i
               WHERE i.org_id = $1 AND i.pack_id = $3 AND i.status = 'succeeded'
                 AND i.result_json -> 'skillIds' @> to_jsonb(s.id)
            )
            -- 跨包共享的 skill：另一个包也装过它，本包不再发货不等于没人发货——不下线。
            AND NOT EXISTS (
              SELECT 1 FROM starter_pack_imports o
               WHERE o.org_id = $1 AND o.pack_id <> $3 AND o.status = 'succeeded'
                 AND o.result_json -> 'skillIds' @> to_jsonb(s.id)
            )
          RETURNING s.id`,
        [input.orgId, [...input.keepStableNames], input.packId],
      );
      const ids = retired.rows.map((row) => row.id);
      if (ids.length > 0) {
        await session.query(
          `UPDATE capability_listings SET enabled = false
            WHERE org_id = $1 AND kind = 'skill' AND id = ANY($2::text[])`,
          [input.orgId, ids],
        );
      }
      return ids;
    });
  }

  async recordFailure(input: Parameters<SkillStarterImportRepository["recordFailure"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);
      const existing = await findImport(session, input.orgId, input.idempotencyKey);
      if (existing && isRetryableFailure(existing, input.payloadDigest)) {
        // 同键重试又失败：更新为最新一次的失败原因（配置修好前后原因可能不同），不新增行。
        await session.query(
          `UPDATE starter_pack_imports
              SET failure_code = $3, pack_digest = $4, administrator_id = $5, imported_at = $6
            WHERE id = $1 AND org_id = $2`,
          [existing.id, input.orgId, input.failureCode, input.packDigest, input.actorId, new Date().toISOString()],
        );
        return { kind: "previous-failure" as const, failureCode: input.failureCode };
      }
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
