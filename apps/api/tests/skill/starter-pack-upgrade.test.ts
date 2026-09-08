// @global-scope-fixture platform-org-write: 写 `org-platform` 名下的平台 skill 行。跨 org 可见是产品事实
//   （`pg-skill-contract-repository` 的 `OR sk.org_id = PLATFORM_ORG_ID`），`resetOrgs(<自己的 org>)`
//   碰不到它、`wave2_skill_immutable_trg` 又挡着删除 ⇒ **没有文件能收敛它**。断言侧一律按归属
//   过滤（`withoutPlatformOwnedSkills`），不要按名字——见 issue #2982 / PR #2978。
// @global-scope-fixture seeder:ensurePlatformSkillCatalogSeeded: 同上——本文件只**调用**它把平台目录
//   种齐（用例 ⑤ 需要平台行存在才能证明「平台行不是升级目标」，用例 ⑥ 需要平台 org 本身存在），
//   种进去的东西与其它文件调用它的结果逐字节相同（幂等），不新增任何本文件独有的全局行。
// @global-scope-fixture seeder:ensureStandardSkillPacksSeeded: 用例 ⑥ 注入的两项里，失败那项
//   （`standard-web@9.9.9`）只写一行 `failed` 的 `starter_pack_imports`；成功那项
//   （`standard-canvas@1.0.0`）本来就在 `STANDARD_PLATFORM_PACKS` 里、任何调用方都会种同一份，
//   幂等键相同 ⇒ 不会留下别的文件看不见的额外状态。
/**
 * 标准 skill 包的**升级路径**，以及 seeding 循环的**单包隔离**。
 *
 * ## 事故（2026-09-09 真实 Postgres 取证，本 PR 之前的代码）
 *
 * `standard-web` 包的构建/校验锚定 1.1.2，运行时 seeder 只发 1.1.1，组织实际拿到的
 * 是旧正文。而**往任何一边收都收不了**：把 seeder bump 到 1.1.2，幂等键
 * （`platform-builtin:<packId>:<packVersion>`，版本在键里）就变成新的 ⇒ 走完整导入
 * ⇒ `stable_name` 撞上已有行 ⇒ `name-conflict`。实测输出：
 *
 *     platform-builtin:standard-web:1.1.2 | failed | SKILL_STARTER_PACK_CONFLICT
 *     web-artifact | semantic_label=1.0.1 | bytes=3384 | published   ← 新正文一个字节没进去
 *
 * 而 seeding 循环没有 per-pack try/catch、`standard-web` 又恰好排第一，所以让它失败
 * 就等于九个包集体消失。实测（全新库，第一项指向不存在的 9.9.9）：
 * `starter_pack_imports` 只有那**一行**，其余八个包零行。
 *
 * ## 这个文件锁什么
 *
 * ① 同 `stable_name` 的新版本 = 升级：新正文真的落库、成为生效版本；
 * ② 历史版本一行不动（不可变），且不多铸一个 skill 行；
 * ③ 正文没变的 skill 不产生新版本（否则每次进程启动堆一个版本）；
 * ④ 升级可重入：同一个版本再跑一次，版本数不变；
 * ⑤ **反证**——真正的重名冲突照旧被拒。①放宽的是「升级目标自己那几行」，
 *    不是把整条冲突检查改宽。没有 ⑤，① 可以靠「把检查删掉」骗到绿。
 * ⑥ 单包隔离：第一个包炸掉，后面的包照常导入。
 *
 * ⚠ 全部跑在**每条用例自己的随机 org** 上（⑥ 除外，它必须用平台 org 才是被测路径），
 *   不碰平台组织那份全局夹具——见 `platform-owned-skills.ts` 头注。
 */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, seedOrg, addOrgMember, resetOrgs } from "../support/db";
import { importSkillStarterPack, SkillStarterPackConflictError } from "../../src/application/skill-import/import-skill-starter-pack";
import { FileSkillStarterPackSource } from "../../src/infrastructure/skill/file-skill-starter-pack-source";
import { PgSkillStarterImportRepository } from "../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { ensureStandardSkillPacksSeeded } from "../../src/infrastructure/skill/ensure-standard-skill-packs";
import { ensurePlatformSkillCatalogSeeded } from "../../src/infrastructure/skill/ensure-platform-skill-catalog";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../src/domain/skill/starter-pack";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PACK_DIR = fileURLToPath(new URL("../../../../skills/starter-packs/", import.meta.url));
const ADMIN = "starter-upgrade-admin";

function makeDeps(db: PgDatabase) {
  return {
    identities: new PgIdentityRepository(db),
    packs: new FileSkillStarterPackSource(PACK_DIR),
    imports: new PgSkillStarterImportRepository(db),
  };
}

/** 每条用例自己的 org + admin 身份，用完 `resetOrgs` 收敛。 */
async function withOrg<T>(fn: (orgId: string, db: PgDatabase) => Promise<T>): Promise<T> {
  ensureDatabase();
  await migrateOnce();
  const orgId = `starter-upg-${randomUUID()}`;
  await seedOrg({ orgId, projectId: `project-${orgId}` });
  await addOrgMember(orgId, ADMIN, "admin", null);
  const db = new PgDatabase(migrationConfig());
  try {
    return await fn(orgId, db);
  } finally {
    await db.close();
    await resetOrgs(orgId);
  }
}

const importPack = (db: PgDatabase, orgId: string, packId: string, packVersion: string) =>
  importSkillStarterPack(makeDeps(db), {
    actorId: ADMIN,
    orgId: toOrgId(orgId),
    packId,
    packVersion,
    idempotencyKey: `test:${packId}:${packVersion}`,
  });

interface VersionRow {
  skill_id: string;
  version_id: string;
  semantic_label: string;
  bytes: number;
  published: boolean;
}

/** 该 org 名下某个 stable_name 的全部版本（含正文字节数），按创建顺序。 */
async function versionsOf(orgId: string, stableName: string): Promise<VersionRow[]> {
  const rows = await asApp(orgId, (c) =>
    c.query<VersionRow>(
      `SELECT s.id AS skill_id, v.id AS version_id, v.semantic_label,
              octet_length(f.content)::int AS bytes, v.published
         FROM skills s
         JOIN skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
         JOIN skill_version_files f ON f.version_id = v.id AND f.org_id = v.org_id AND f.path = 'SKILL.md'
        WHERE s.org_id = $1 AND s.stable_name = $2
        ORDER BY v.created_at, v.id`,
      [orgId, stableName],
    ));
  return rows.rows;
}

/** 运行时读法：生效版本 = 最新一条 published（与 `pg-skill-contract-repository.listAll` 一致）。 */
async function currentVersion(orgId: string, stableName: string): Promise<VersionRow> {
  const all = await versionsOf(orgId, stableName);
  const published = all.filter((r) => r.published);
  const last = published[published.length - 1];
  if (!last) throw new Error(`${stableName} 没有任何已发布版本`);
  return last;
}

/**
 * 用例 ① 的夹具：**从真实发货的 `standard-web` 1.1.1/1.1.2 派生**，只把
 * `stableName`/`name` 换成本次运行独有的随机名，再按 domain 自己的规则重算
 * `packDigest`。正文一个字节没动——升级前后的体积差（3384 → 5439）就是线上那份差异。
 *
 * ## 为什么不能直接导入真的 `standard-web`（这是实测撞出来的，不是预防性设计）
 *
 * 冲突检查同时查 `PLATFORM_ORG_ID`（design-delta `platform-owned-skills`：平台行对
 * 每个 org 可见，见 `pg-skill-starter-import-repository` 里那段注释）。共享隔离库里
 * 只要**任何**别的测试文件先调过 `ensurePlatformSkillCatalogSeeded()`，平台 org 名下
 * 就已经有 `web-artifact` 了 ⇒ 本用例那个全新随机 org 第一次导入就判冲突。
 * 实测形态正是本仓最忌讳的那种：**单独跑绿、全量跑红**（`tests/skill/` 全量下
 * `SkillStarterPackConflictError` 抛在第一次 `importPack`）。
 *
 * ⚠ 那条冲突本身是**既有产品行为**，不是这次改动引入的，也不在这次的范围里
 *   （「组织能不能导入平台已有的标准包」是另一个问题）。用例只要不依赖它即可。
 */
function writeDerivedPack(dir: string, packId: string, sourceVersion: string, suffix: string): void {
  const raw = JSON.parse(readFileSync(join(PACK_DIR, "standard-web", `${sourceVersion}.json`), "utf8")) as {
    schemaVersion: unknown; packId: string; packVersion: string; packDigest: string;
    skills: { stableName: string; name: string }[];
  };
  const skills = raw.skills.map((skill) => ({
    ...skill,
    stableName: `${skill.stableName}-${suffix}`,
    name: `${skill.name}-${suffix}`,
  }));
  const unsigned = { schemaVersion: raw.schemaVersion, packId, packVersion: raw.packVersion, skills };
  const pack = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
  mkdirSync(join(dir, packId), { recursive: true });
  writeFileSync(join(dir, packId, `${raw.packVersion}.json`), JSON.stringify(pack));
}

it("① ② ③ ④ 同一个 stable_name 的新包版本走升级，历史不动、未变的 skill 不堆版本、重入不变", async () => {
  const suffix = randomUUID().slice(0, 8);
  const packId = `upgrade-fixture-${suffix}`;
  const dir = mkdtempSync(join(tmpdir(), "wsx-pack-"));
  writeDerivedPack(dir, packId, "1.1.1", suffix);
  writeDerivedPack(dir, packId, "1.1.2", suffix);

  try {
    await withOrg(async (orgId, db) => {
      const deps = {
        identities: new PgIdentityRepository(db),
        packs: new FileSkillStarterPackSource(dir),
        imports: new PgSkillStarterImportRepository(db),
      };
      const run = (packVersion: string) => importSkillStarterPack(deps, {
        actorId: ADMIN, orgId: toOrgId(orgId), packId, packVersion,
        idempotencyKey: `test:${packId}:${packVersion}`,
      });
      const artifact = `web-artifact-${suffix}`;
      const research = `web-research-${suffix}`;

      // --- 先按旧版本种一轮（= 组织今天的真实状态）
      await run("1.1.1");
      const before = await currentVersion(orgId, artifact);
      expect(before.semantic_label).toBe("1.0.1");
      const researchBefore = await versionsOf(orgId, research);
      expect(researchBefore).toHaveLength(1);

      // --- 升级到 1.1.2
      expect((await run("1.1.2")).created).toBe(true);

      // ① 新正文真的成为生效版本（体积差就是线上那份 3384 → 5439）
      const after = await currentVersion(orgId, artifact);
      expect(after.semantic_label).toBe("1.0.2");
      expect(after.version_id).not.toBe(before.version_id);
      expect(before.bytes).toBe(3384);
      expect(after.bytes).toBe(5439);

      // ② 历史版本原样留着，且没有多铸一个 skill 行
      const allWeb = await versionsOf(orgId, artifact);
      expect(allWeb).toHaveLength(2);
      expect(allWeb[0]).toEqual(before);
      expect(new Set(allWeb.map((r) => r.skill_id)).size).toBe(1);

      // ③ 同一个包里正文没变的 skill（两版都是 1.0.0）不产生新版本
      expect(await versionsOf(orgId, research)).toEqual(researchBefore);

      // ④ 再跑一次 1.1.2：幂等键命中 ⇒ 重放，版本数不变
      expect((await run("1.1.2")).created).toBe(false);
      expect(await versionsOf(orgId, artifact)).toEqual(allWeb);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 300000);

it("⑤ 反证：真正的重名冲突照旧被拒——放宽的只是升级目标自己那几行", async () => {
  await withOrg(async (orgId, db) => {
    // 平台组织名下的官方 skill 对每个 org 可见；它不是本 org 的行，因此不是升级目标。
    const seeded = await ensurePlatformSkillCatalogSeeded();
    expect(seeded.ok).toBe(true);

    // 本 org 先造一个和 pack 里某个 skill 同显示名、但 stable_name 不同的 skill，
    // 它同样不是升级目标（stable_name 对不上）⇒ 必须判冲突。
    const packJson = await new FileSkillStarterPackSource(PACK_DIR).load("standard-web", "1.1.1") as {
      skills: { stableName: string; name: string }[];
    };
    const collidingName = packJson.skills[0]!.name;
    await asApp(orgId, (c) =>
      c.query(
        `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
        [`skill-${randomUUID()}`, orgId, "a-totally-different-stable-name", collidingName, ADMIN],
      ));

    await expect(importPack(db, orgId, "standard-web", "1.1.1"))
      .rejects.toBeInstanceOf(SkillStarterPackConflictError);

    // 冲突被记录下来，且一个 skill 都没被种进去
    const web = await versionsOf(orgId, "web-artifact");
    expect(web).toHaveLength(0);
    const failed = await asApp(orgId, (c) =>
      c.query<{ failure_code: string }>(
        `SELECT failure_code FROM starter_pack_imports WHERE org_id = $1 AND status = 'failed'`, [orgId]));
    expect(failed.rows.map((r) => r.failure_code)).toEqual(["SKILL_STARTER_PACK_CONFLICT"]);
  });
}, 300000);

it("⑥ 单包隔离：第一个包失败不拖垮后面的包", async () => {
  ensureDatabase();
  await migrateOnce();
  // 这一条必须跑在平台 org 上——被测的正是 `ensureStandardSkillPacksSeeded` 自己的循环。
  // 注入的两项：第一项是一个**不存在**的版本（必然失败），第二项是本来就会被种的
  // 真实发货包，所以这条用例不会往平台组织里留下任何多余的东西。
  const org = await ensurePlatformSkillCatalogSeeded();
  expect(org.ok).toBe(true);
  const db = new PgDatabase(migrationConfig());
  try {
    const reports = await ensureStandardSkillPacksSeeded(db, "svc-platform-templates", [
      { packId: "standard-web", packVersion: "9.9.9" },
      { packId: "standard-canvas", packVersion: "1.0.0" },
    ]);
    expect(reports).toHaveLength(2);
    expect(reports[0]!.ok).toBe(false);
    expect(reports[0]!.error).toBeInstanceOf(Error);
    // 关键断言：第一个包炸了之后，第二个包**仍然被处理了**。
    expect(reports[1]!.ok).toBe(true);
    expect(reports[1]!.packId).toBe("standard-canvas");
    const canvas = await asApp(PLATFORM_ORG_ID, (c) =>
      c.query(`SELECT 1 FROM starter_pack_imports
                WHERE org_id = $1 AND idempotency_key = 'platform-builtin:standard-canvas:1.0.0'
                  AND status = 'succeeded'`, [PLATFORM_ORG_ID]));
    expect(canvas.rows).toHaveLength(1);
  } finally {
    await db.close();
  }
}, 300000);
