/**
 * #1559 —— 「线程挂载进 run 快照」那条读口的**真库**门（`PgThreadMountedSkillReader`）。
 *
 * ## 它证的是什么
 *
 * #1559 确诊了两条独立断裂：
 *   ① 挂模型 A 的 skill 撞外键 —— **已由 #1534（PR #1539，2026-08-18 合入）修掉**，
 *      那条迁移把 `thread_skill_mounts_skill_fk` 整个删了。本文件第 ① 条把它钉住：
 *      模型 A 的挂载现在真的存得进去，一旦有人把那个外键加回来就会红。
 *   ② 挂模型 B 的 skill 存得下、**运行时读不到**（`readPinnedSkills` 只读模型 A）。
 *      ⇒ 注入必须把它排除，否则整次 run 以 `SKILL_VERSION_UNAVAILABLE` 失败。
 *      第 ③ 条钉住这一条，且存量行本身不删不迁（第 ④ 条）。
 *
 * ## 为什么必须连真库
 *
 * 这里每一条都是**数据库层的事实**：外键还在不在、JOIN 判出来的是哪几行、
 * 排序与 `removed_at` 过滤对不对。用替身写一遍，等于把「我以为 PostgreSQL 会这样」
 * 当成结论——本仓 `static-trace-vs-live-fact.md` 点名的形状。
 *
 * 跑法（复用既有 compose postgres，不新起栈）：
 *   pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
 *     pnpm --filter @repo/api exec vitest run tests/skill/thread-mount-run-injection-real-db.test.ts
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgThreadMountedSkillReader } from "../../src/infrastructure/chat/pg-thread-mounted-skill-reader";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { discloseDecided } from "../../src/application/security/permission-filter";
import type { PermissionDecision } from "../../src/domain/identity/permission-decision";

const ORG = "org-i1559-mount-fk";
const ACTOR = "u-i1559-actor";
const THREAD = "thread-i1559";
const PROJECT = "project-i1559";

/** 模型 A（`skills` / `skill_versions`）—— 运行时唯一读得到的那套。 */
const REGISTRY_SKILL = "skill-i1559-registry";
const REGISTRY_VERSION = "skill-i1559-registry-v1";
const REGISTRY_SKILL_2 = "skill-i1559-registry-2";
const REGISTRY_VERSION_2 = "skill-i1559-registry-2-v1";
/** 模型 B（`skill_contracts`）—— 存量形态，F190 之后不可能新增。 */
const CONTRACT_SKILL = "skill-i1559-contract";
const CONTRACT_VERSION = "skill-i1559-contract-v1";

const DIGEST = "a".repeat(64);

/**
 * 本文件测的是 **SQL 那一层**（外键挡不挡、触发器填什么、读口筛什么），不是判权。
 * 判权本身由 `resolve-visibility` 与 `permission-filter` 自己的测试覆盖，这里给一个
 * 恒允许的判定，只为把 `Guarded` 的封套拆开——`discloseDecided` 只读它的
 * `allowed` / `decisionId`。⚠ **不要**把这个常量搬去测判权：它恒真。
 */
const ALLOW_ALL = { allowed: true, decisionId: "decision-i1559" } as unknown as PermissionDecision;

async function seedRegistrySkill(skillId: string, versionId: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
       VALUES ($1,$2,$3,$3,'enabled',$4,now(),now()) ON CONFLICT (id) DO NOTHING`,
      [skillId, ORG, skillId, ACTOR],
    );
    // ⚠ 必须先 draft、再 publish：`wave2_skill_version_starts_draft` 触发器逐字拒绝
    //   直接插一行 `published = true`（「Skill versions must be assembled as drafts
    //   before publish」）。这不是测试的绕路，这就是真实写路径的形状。
    await c.query(
      `INSERT INTO skill_versions
         (id, org_id, skill_id, semantic_label, content_digest, manifest, creator_id, created_at, published)
       VALUES ($1,$2,$3,'1.0.0',$4,'{}'::jsonb,$5,now(),false) ON CONFLICT (id) DO NOTHING`,
      [versionId, ORG, skillId, DIGEST, ACTOR],
    );
    // 发布前必须恰好有一个根 `SKILL.md`（`wave2_publish_skill_version` 自己校验），
    // 且 `app_rw` 对 `skill_versions` 没有 UPDATE 权限 —— 发布只能走这条
    // SECURITY DEFINER 通道。这里走的与产品导入路径是同一条。
    await c.query(
      `INSERT INTO skill_version_files (org_id, version_id, path, content, media_type, digest)
       VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4) ON CONFLICT (version_id, path) DO NOTHING`,
      [ORG, versionId, Buffer.from(`# ${skillId}`, "utf8"), createHash("sha256").update(`# ${skillId}`).digest("hex")],
    );
    await c.query("SELECT wave2_publish_skill_version($1, $2)", [ORG, versionId]);
  });
}

async function seedContractSkill(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by)
       VALUES ($1,$2,$1,'d','自建','已启用','org-wide',NULL,$3,false,$4)
       ON CONFLICT (id) DO NOTHING`,
      [CONTRACT_SKILL, ORG, CONTRACT_VERSION, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_contract_versions
         (id, org_id, skill_id, version_number, state, prompt_template, input_schema,
          output_schema, data_scope, reads_raw_transcript, fallback_declaration,
          model_ref, content_hash, created_by)
       VALUES ($1,$2,$3,1,'已生效','p','{}','{}','[]'::jsonb,false,'f','m/x',$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [CONTRACT_VERSION, ORG, CONTRACT_SKILL, DIGEST, ACTOR],
    );
  });
}

/** 按 `pg-thread-mount-store.ts` 那条 INSERT 的**列集合**写一行（不含 `skill_model`）。 */
async function mount(input: {
  mountId: string; skillId: string; versionId: string; mountedAt: string;
  removedAt?: string | null;
}): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO thread_skill_mounts
         (mount_id, org_id, thread_id, skill_id, version_id, mounted_at, removed_at)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)`,
      [input.mountId, ORG, THREAD, input.skillId, input.versionId,
        input.mountedAt, input.removedAt ?? null],
    );
  });
}

function mountExists(mountId: string): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query(
      `SELECT 1 FROM thread_skill_mounts WHERE org_id = $1 AND mount_id = $2`,
      [ORG, mountId],
    );
    return r.rows.length;
  });
}

describe("#1559 线程挂载 → run 快照的注入读口", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    await seedRegistrySkill(REGISTRY_SKILL, REGISTRY_VERSION);
    await seedRegistrySkill(REGISTRY_SKILL_2, REGISTRY_VERSION_2);
    await seedContractSkill();
  }, 120_000);

  it("① 挂**模型 A**（`skills`/`skill_versions`）的 skill 存得进去 —— #1534 删掉那个外键之后的现状", async () => {
    // 这条会在有人把 `thread_skill_mounts_skill_fk`（REFERENCES skill_contracts）
    // 加回来的那一刻红——那正是 #1534 修的、#1559 复述过的那条真实故障
    // （GitHub 导入的 skill 在 chat 里点一下必现 500/404）。
    await expect(mount({
      mountId: "m-registry-1", skillId: REGISTRY_SKILL, versionId: REGISTRY_VERSION,
      mountedAt: "2026-08-18T01:00:00Z",
    })).resolves.toBeUndefined();
  });

  it("② 挂**模型 B**（`skill_contracts`）的存量 skill 也照样存得下（不删不迁存量形态）", async () => {
    await expect(mount({
      mountId: "m-contract-1", skillId: CONTRACT_SKILL, versionId: CONTRACT_VERSION,
      mountedAt: "2026-08-18T00:00:00Z",
    })).resolves.toBeUndefined();
  });

  it("③ 注入读口只吐模型 A、只吐生效的、且按 mounted_at 升序", async () => {
    // 一条**已摘除**的模型 A 挂载：保留行（I-19），但不该进任何一次新的 run。
    await mount({
      mountId: "m-registry-removed", skillId: REGISTRY_SKILL_2, versionId: REGISTRY_VERSION_2,
      mountedAt: "2026-08-18T00:30:00Z", removedAt: "2026-08-18T00:45:00Z",
    });
    // 一条 skill_id 与 version_id **对不上**的挂载：#1534 删掉库级外键后，
    // 这种行在物理上可表示了，引用完整性归应用层——就是读口那条 JOIN。
    await mount({
      mountId: "m-registry-crossed", skillId: REGISTRY_SKILL, versionId: REGISTRY_VERSION_2,
      mountedAt: "2026-08-18T02:00:00Z",
    });
    // 一条生效的、时间更晚的模型 A 挂载，用来验顺序。
    await mount({
      mountId: "m-registry-2", skillId: REGISTRY_SKILL_2, versionId: REGISTRY_VERSION_2,
      mountedAt: "2026-08-18T03:00:00Z",
    });

    const db = new PgDatabase(appConfig());
    try {
      const reader = new PgThreadMountedSkillReader(db);
      const guarded = await reader.activeMountedSkillVersionIds(
        toOrgId(ORG), { projectId: PROJECT, threadId: THREAD },
      );
      const disclosed = discloseDecided(guarded, ALLOW_ALL);
      expect("payload" in disclosed, "恒允许的判定下应该拿得到载荷").toBe(true);
      const ids = (disclosed as { payload: readonly string[] }).payload;

      // 逐字相等，不是「包含」——「包含」对任何顺序、任何多余项都成立。
      // · 模型 B 的 `m-contract-1`（mounted_at 最早）**不在**里面：运行时读不到它，
      //   塞进 run 快照会让整次 run 以 SKILL_VERSION_UNAVAILABLE 失败。
      // · 已摘除的 `m-registry-removed` 不在里面。
      // · skill/version 对不上的 `m-registry-crossed` 不在里面。
      // · 顺序按 mounted_at 升序。
      expect(ids).toEqual([REGISTRY_VERSION, REGISTRY_VERSION_2]);
    } finally {
      await db.close();
    }
  });

  it("④ 存量模型 B 的挂载行**还在**（本轮不删不迁任何历史）", async () => {
    expect(await mountExists("m-contract-1")).toBe(1);
  });
});
