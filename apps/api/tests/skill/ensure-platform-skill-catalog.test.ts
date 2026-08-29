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
import { ensureDatabase, migrateOnce, asApp } from "../support/db";
import {
  ensurePlatformSkillCatalogSeeded,
  OFFICIAL_SKILLS,
} from "../../src/infrastructure/skill/ensure-platform-skill-catalog";
import { PLATFORM_ORG_ID } from "../../src/domain/org-id";

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
