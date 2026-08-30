/**
 * issue #2343 —— `ensurePlatformSkillCatalogSeeded` 的反证：真实 devapp 场景里
 * `deploy.sh` 4i/4j 两步依赖的"部署脚本已刷新"这个前提从未成立过，`pdf-create`
 * 等四个官方 skill 因此从未真正落库。修法是把两个 backfill 函数挂到 `main.ts`
 * 的真实进程入口自愈——见 `ensure-platform-skill-catalog.ts` 文件头的完整事故
 * 复盘。
 *
 * 这里不重复测"挂载/执行/可见性"（`platform-owned-skills-real-stack.test.ts`/
 * `platform-template-visibility.test.ts` 已经覆盖，且未受这次重构影响——见那两个
 * 文件在这次改动后仍然全绿），只测这个新增的组合入口自己的行为：真的把两步接对了
 * 顺序、真的幂等、真的不 throw。
 */
import { describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, asApp, asOwner } from "../support/db";
import {
  ensurePlatformSkillCatalogSeeded,
  OFFICIAL_SKILLS,
} from "../../src/infrastructure/skill/ensure-platform-skill-catalog";
import { PgAssetFileRepository } from "../../src/infrastructure/asset/pg-asset-file-repository";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

describe("ensurePlatformSkillCatalogSeeded（issue #2343）", () => {
  it("从不 throw，返回 { ok: true, report }（org 先于 skills，两段报告都在）", async () => {
    ensureDatabase();
    await migrateOnce();

    const result = await ensurePlatformSkillCatalogSeeded();

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrows for TS; unreachable given the assertion above
    expect(result.report.org).toEqual(expect.objectContaining({
      orgCreated: expect.any(Boolean),
      membershipCreated: expect.any(Boolean),
    }));
    expect(result.report.skills.created.length + result.report.skills.alreadyExisted.length)
      .toBe(OFFICIAL_SKILLS.length);
  }, 30_000);

  it("连续调用两次：第二次的四个 skill 全部落在 alreadyExisted，不重复创建（真幂等，不是巧合）", async () => {
    ensureDatabase();
    await migrateOnce();

    await ensurePlatformSkillCatalogSeeded(); // 第一次：把状态收敛到"已存在"
    const second = await ensurePlatformSkillCatalogSeeded();

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.skills.created).toEqual([]);
    expect([...second.report.skills.alreadyExisted].sort()).toEqual(
      OFFICIAL_SKILLS.map((s) => s.stableName).sort(),
    );
  }, 30_000);

  it("种下的四个 skill 真的是 status='enabled' 且挂在 PLATFORM_ORG_ID 下（不是伪造的报告数字）", async () => {
    ensureDatabase();
    await migrateOnce();
    await ensurePlatformSkillCatalogSeeded();

    const rows = await asApp(PLATFORM_ORG_ID, (c) => c.query<{ stable_name: string; status: string }>(
      "SELECT stable_name, status FROM skills WHERE org_id = $1 AND stable_name = ANY($2::text[])",
      [PLATFORM_ORG_ID, OFFICIAL_SKILLS.map((s) => s.stableName)],
    ));
    expect(rows.rows.length).toBe(OFFICIAL_SKILLS.length);
    for (const row of rows.rows) expect(row.status).toBe("enabled");
  }, 30_000);
});

/**
 * 「/admin/skill 编辑 PDF/Word/Excel/演示文稿报『找不到 Skill』」的根因回归。
 *
 * PR review（`review:changes`，2026-08-30）指出：
 *   1. 此前只改了 3 处硬编码 id 格式的**期望字符串**（`org-scoped-capabilities.test
 *      .ts` 等），没有一条 DB-backed 测试真的跑过"旧代码已经把错误 id 落库，进程
 *      重启自愈"这条路径，也没有跑过 `PgAssetFileRepository.getDirectory`/`readFile`
 *      验证编辑页真的能打开。
 *   2. `UPDATE ... AND NOT EXISTS (...)` 那一步在目标 id 已被别的记录占用时会静默
 *      跳过改名，后面 `INSERT ... ON CONFLICT DO NOTHING` 也会静默成功——整个函数
 *      看起来"跑完了"，但目录状态其实是坏的（旧的 `cap-` 行还在，编辑页依旧 404）。
 *
 * 下面三组补上这两类反证：① 新库种子后 id 一致 + 编辑页读路径真的通；② 模拟"已经
 * 用旧 id 部署过"的库，重跑一次自愈；③ 目标 id 被别的记录抢先占用时显式失败，
 * 不静默报告成功。
 */
describe("ensurePlatformSkillsSeeded —— capability_listings.id 与 skills.id 的一致性回归", () => {
  it("① 新库种子：capability_listings.id 与 skills.id 逐字相同，且编辑页真实读路径 (getDirectory/readFile) 都能打通", async () => {
    ensureDatabase();
    await migrateOnce();
    const orgId = toOrgId(PLATFORM_ORG_ID);

    // 起点必须干净——不能假设这是全新库（同一进程里前面的 it 可能已经种过）：
    // 直接读回当前状态，而不是重新造一个「绝对空」的库（`skills`/`skill_versions`
    // 对 app_rw 只 GRANT SELECT/INSERT，测试角色本来就删不掉它们，见 `ensure-
    // platform-skill-catalog.ts` 文件头）。种子函数本身是幂等的，这条断言在
    // "从未种过"与"已经种过"两种起点下都必须成立。
    await ensurePlatformSkillCatalogSeeded();

    const rows = await asApp(PLATFORM_ORG_ID, (c) => c.query<{ id: string; name: string }>(
      `SELECT id, name FROM capability_listings WHERE org_id = $1 AND kind = 'skill' AND name = ANY($2::text[])`,
      [PLATFORM_ORG_ID, OFFICIAL_SKILLS.map((s) => s.displayName)],
    ));
    expect(rows.rows.length).toBe(OFFICIAL_SKILLS.length);
    const byName = new Map(rows.rows.map((r) => [r.name, r.id]));
    for (const spec of OFFICIAL_SKILLS) {
      // 修复前这里会是 `cap-${spec.skillId}`——与 skills.id 不是同一个字符串。
      expect(byName.get(spec.displayName)).toBe(spec.skillId);
    }

    // 编辑页真正走的读路径：`skill-content-editor.tsx` 把目录页展示的
    // `capability_listings.id`（上面刚断言过等于 `spec.skillId`）原样当 `assetId`
    // 传给 `AgSkillEditor` → `GetAssetDirectory`/`ReadAssetFile`。旧代码下这里传
    // 进来的会是 `cap-${spec.skillId}`，`getDirectory` 恒返回 `null`（前端显示
    // 「找不到 Skill」）。
    const repo = new PgAssetFileRepository(new PgDatabase(appConfig()), new FixtureAssetFileRepository());
    for (const spec of OFFICIAL_SKILLS) {
      const assetId = byName.get(spec.displayName)!;
      const dir = await repo.getDirectory(orgId, "skill", assetId);
      expect(dir, `${spec.displayName}: getDirectory(assetId=${assetId}) 不应为 null`).not.toBeNull();
      const file = await repo.readFile(orgId, "skill", assetId, "SKILL.md");
      expect(file, `${spec.displayName}: readFile(SKILL.md) 不应为 null`).not.toBeNull();
      expect(file!.sizeBytes).toBeGreaterThan(0);
    }
  }, 30_000);

  it("② 自愈：模拟『已经用旧 cap- 前缀 id 部署过』的库，重跑一次种子函数后原地改名，编辑页读路径恢复正常", async () => {
    ensureDatabase();
    await migrateOnce();
    const orgId = toOrgId(PLATFORM_ORG_ID);
    await ensurePlatformSkillCatalogSeeded(); // 先收敛到「已存在」

    const legacySpec = OFFICIAL_SKILLS[0]!;
    const legacyId = `cap-${legacySpec.skillId}`;
    // 用 owner 角色直接把这一行的 id 改回旧格式——模拟「这个环境在修复前就已经
    // seed 过一次，capability_listings 里还留着旧 id」，而不是从头插入一行
    // （旧代码本来就是这样落库的，这里只是把状态倒回那一刻）。
    await asOwner((c) => c.query(
      `UPDATE capability_listings SET id = $1 WHERE org_id = $2 AND id = $3`,
      [legacyId, PLATFORM_ORG_ID, legacySpec.skillId],
    ));
    const beforeHeal = await asApp(PLATFORM_ORG_ID, (c) => c.query(
      `SELECT id FROM capability_listings WHERE org_id = $1 AND name = $2`,
      [PLATFORM_ORG_ID, legacySpec.displayName],
    ));
    expect(beforeHeal.rows[0]?.id).toBe(legacyId); // 确认「已部署过旧代码」的前置状态真的搭好了

    const healed = await ensurePlatformSkillCatalogSeeded();
    expect(healed.ok).toBe(true);

    const afterHeal = await asApp(PLATFORM_ORG_ID, (c) => c.query(
      `SELECT id FROM capability_listings WHERE org_id = $1 AND name = $2`,
      [PLATFORM_ORG_ID, legacySpec.displayName],
    ));
    expect(afterHeal.rows[0]?.id).toBe(legacySpec.skillId); // 原地改名回正确 id，不是新插入第二行
    const total = await asApp(PLATFORM_ORG_ID, (c) => c.query(
      `SELECT count(*)::int AS n FROM capability_listings WHERE org_id = $1 AND name = $2`,
      [PLATFORM_ORG_ID, legacySpec.displayName],
    ));
    expect(total.rows[0]?.n).toBe(1); // 没有留下一份改名前的重复行

    const repo = new PgAssetFileRepository(new PgDatabase(appConfig()), new FixtureAssetFileRepository());
    const dir = await repo.getDirectory(orgId, "skill", legacySpec.skillId);
    expect(dir).not.toBeNull();
    const file = await repo.readFile(orgId, "skill", legacySpec.skillId, "SKILL.md");
    expect(file).not.toBeNull();
  }, 30_000);

  it("③ fail-closed：目标 id 已被另一条记录占用时显式失败，不静默把损坏状态报告成功", async () => {
    ensureDatabase();
    await migrateOnce();
    await ensurePlatformSkillCatalogSeeded(); // 先收敛到「已存在」这个基线

    const spec = OFFICIAL_SKILLS[OFFICIAL_SKILLS.length - 1]!; // pdf-create：数组最后一个，前面几个先正常处理完
    const vacatedId = `test-collision-vacated-${spec.skillId}`;
    try {
      // 把当前占着 spec.skillId 的行（基线种子已经建好的那一行）先挪开，
      // 再插入一条「同一个 id，但不是这个官方 skill」的记录——capability_listings
      // 对 app_rw 只 GRANT SELECT/INSERT/UPDATE，没有 DELETE（`0008-f15-capability-
      // listings.sql`），所以用 UPDATE 挪走而不是删除，owner 角色两步都能做。
      await asOwner((c) => c.query(
        `UPDATE capability_listings SET id = $1 WHERE org_id = $2 AND id = $3`,
        [vacatedId, PLATFORM_ORG_ID, spec.skillId],
      ));
      await asOwner((c) => c.query(
        `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, enabled, endpoint)
         VALUES ($1, $2, 'skill', $3, 'org-wide', NULL, true, NULL)`,
        [spec.skillId, PLATFORM_ORG_ID, "一个不相关的记录（占位测试用）"],
      ));

      const result = await ensurePlatformSkillCatalogSeeded();
      expect(result.ok).toBe(false); // 不能是 ok:true——目录状态其实是坏的
      if (result.ok) return;
      expect(String((result.error as Error)?.message ?? result.error)).toMatch(/已被另一行占用/);
    } finally {
      // 复原：删掉占位的冒名行（owner 角色不受 app_rw 的 GRANT 限制），把真正的
      // 官方 skill 行 id 改回来——不让这条测试往共享 DB 里留下永久性的坏数据。
      await asOwner((c) => c.query(
        `DELETE FROM capability_listings WHERE org_id = $1 AND id = $2 AND name = $3`,
        [PLATFORM_ORG_ID, spec.skillId, "一个不相关的记录（占位测试用）"],
      ));
      await asOwner((c) => c.query(
        `UPDATE capability_listings SET id = $1 WHERE org_id = $2 AND id = $3`,
        [spec.skillId, PLATFORM_ORG_ID, vacatedId],
      ));
    }
  }, 30_000);
});
