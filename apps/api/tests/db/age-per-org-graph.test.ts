/**
 * Phase 18 F01（#4074，ADR-114 决策 3 / 不变量 I-13）—— 每个 org 一张 AGE 图，幂等创建，
 * 且调用方无法替别的 org 建图或拿到别的 org 的图名。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG_A = "org-kg-f01-graph-a";
const ORG_B = "org-kg-f01-graph-b";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG_A, ORG_B);
  await seedOrg({ orgId: ORG_A, projectId: `${ORG_A}-p` });
  await seedOrg({ orgId: ORG_B, projectId: `${ORG_B}-p` });
});

const ensure = (org: string | null) =>
  asApp(org, async (c) => (await c.query<{ g: string }>("SELECT kg_ensure_current_org_graph() AS g")).rows[0]!.g);

const graphCount = (name: string) =>
  asOwner(async (c) => Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM ag_catalog.ag_graph WHERE name = $1", [name])).rows[0]!.n));

describe("F01: 按 org 建图", () => {
  it("首次使用即创建，ag_graph 里查得到该 org 的图", async () => {
    const g = await ensure(ORG_A);
    expect(g).toMatch(/^wsx_org_[0-9a-f]{24}$/);
    expect(await graphCount(g)).toBe(1);
  });

  it("幂等：重复调用返回同一个图、不建第二张", async () => {
    const g1 = await ensure(ORG_A);
    const g2 = await ensure(ORG_A);
    expect(g2).toBe(g1);
    expect(await graphCount(g1)).toBe(1);
  });

  it("并发首用同一 org 不报错、只建一张", async () => {
    const results = await Promise.all([ensure(ORG_B), ensure(ORG_B), ensure(ORG_B)]);
    expect(new Set(results).size).toBe(1);
    expect(await graphCount(results[0]!)).toBe(1);
  });

  it("两个 org 得到两张不同的图", async () => {
    expect(await ensure(ORG_A)).not.toBe(await ensure(ORG_B));
  });

  it("没有租户上下文时拒绝（不存在「替任意 org 建图」的入口）", async () => {
    await expect(ensure(null)).rejects.toThrow(/KG_NO_TENANT/);
  });

  it("app_rw 对图 schema 没有直接权限：图的读写只能走 SECURITY DEFINER 函数", async () => {
    const g = await ensure(ORG_A);
    await expect(
      asApp(ORG_A, (c) => c.query(`SELECT * FROM ag_catalog.cypher('${g}', $$ MATCH (n) RETURN n $$) AS (n ag_catalog.agtype)`)),
    ).rejects.toThrow(/permission denied/);
  });
});
