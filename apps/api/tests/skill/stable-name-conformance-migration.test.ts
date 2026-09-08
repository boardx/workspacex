/**
 * #3033（第二半）：迁移 `20260910030000_skill_stable_name_conformance.sql` 把遗留的不合规
 * `skills.stable_name`（URL 导入旧路径写的 `sk_<uuid>`、slugify 旧版保留的中文名）规范成
 * 原生 package set 能吃的 slug。DevApp 2026-09-08 实测：一个 `sk_…` 行就让该组织每条
 * 原生 run 在调模型前失败。本测试直接对真库重放迁移 SQL（迁移本身在 globalSetup 已
 * 跑过一次；重放证明幂等），三种坏行各一：下划线 id、中文名、规范化后撞同组织既有名。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-3033-stable-name";
const NATIVE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SQL = readFileSync(join(__dirname, "../../migrations/20260910030000_skill_stable_name_conformance.sql"), "utf8");

async function insertSkill(id: string, stableName: string, name: string) {
  await asOwner(c => c.query(
    `INSERT INTO skills (id, org_id, stable_name, name, status, creator_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'enabled', 'u-3033', now(), now())`, [id, ORG, stableName, name]));
}
async function readAll() {
  return asOwner(async c => (await c.query<{ id: string; stable_name: string }>(
    "SELECT id, stable_name FROM skills WHERE org_id=$1 ORDER BY id", [ORG])).rows);
}

describe("#3033 skills.stable_name 规范化迁移", () => {
  beforeAll(async () => { ensureDatabase(); await migrateOnce(); await resetOrgs(ORG); await seedOrg({ orgId: ORG, projectId: "p-3033" }); });
  afterAll(async () => { await resetOrgs(ORG); });

  it("下划线 id / 中文名 / 规范化撞名三种坏行都变成合规且同组织唯一；已合规的行不动；重放幂等", async () => {
    await insertSkill("sk_aaaa1111", "sk_6574c197-88e6-4c71-b988-8b81dfff9062", "旧 URL 导入");
    await insertSkill("sk_bbbb2222", "AI-转型洞察报告", "AI 转型洞察报告");
    await insertSkill("sk_cccc3333", "report", "report");           // 已合规，占住 report
    await insertSkill("sk_dddd4444", "Report!!", "Report!!");       // 规范化后 = report，撞
    await insertSkill("sk_eeee5555", "pdf-create", "PDF");          // 已合规，不动

    await asOwner(c => c.query(SQL));
    const after = new Map((await readAll()).map(r => [r.id, r.stable_name]));

    expect(after.get("sk_aaaa1111")).toBe("sk-6574c197-88e6-4c71-b988-8b81dfff9062");
    expect(after.get("sk_bbbb2222")).toMatch(/^(ai|skill-[0-9a-f]{8})$/);
    expect(after.get("sk_cccc3333")).toBe("report");
    expect(after.get("sk_dddd4444")).toMatch(/^skill-[0-9a-f]{8}$/);
    expect(after.get("sk_eeee5555")).toBe("pdf-create");
    for (const v of after.values()) expect(v).toMatch(NATIVE);
    expect(new Set(after.values()).size).toBe(after.size);

    // 反证：再跑一次不再改任何行
    const before2 = await readAll();
    await asOwner(c => c.query(SQL));
    expect(await readAll()).toEqual(before2);
  });
});
