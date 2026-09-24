/**
 * Phase 18 F01（#4074，ADR-114）—— 测试库里 `age` 与 `vector` 两个扩展都真的可用。
 *
 * 不只查 `pg_extension` 里有这一行：扩展行存在但 `.so` 没加载（没进 shared_preload_libraries），
 * 第一条 cypher 查询才会炸——所以两条都真的执行一次：一次向量距离，一次 openCypher 读写。
 * 分工：app_rw 只调 SECURITY DEFINER 函数拿到本 org 的图（它自己对 AGE 没有任何直接权限，
 * 见 age-per-org-graph.test.ts）；openCypher 读写由函数属主执行，这里用 owner 连接代表它。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-f01-ext";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
});

describe("F01: Postgres 同时带 pgvector 与 Apache AGE", () => {
  it("两个扩展都已由迁移创建", async () => {
    const rows = await asOwner(async (c) =>
      (await c.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname IN ('age','vector') ORDER BY extname")).rows,
    );
    expect(rows.map((r) => r.extname)).toEqual(["age", "vector"]);
  });

  it("AGE 已预加载：不 LOAD 也能直接跑 cypher", async () => {
    const setting = await asOwner(async (c) => (await c.query<{ v: string }>("SELECT current_setting('shared_preload_libraries') AS v")).rows[0]!.v);
    expect(setting.split(",").map((s) => s.trim())).toContain("age");
  });

  it("pgvector 真的能算距离", async () => {
    const d = await asOwner(async (c) => (await c.query<{ d: number }>("SELECT '[1,0]'::vector <-> '[0,1]'::vector AS d")).rows[0]!.d);
    expect(d).toBeCloseTo(Math.SQRT2, 5);
  });

  it("app_rw 经 kg_ensure_current_org_graph 拿到本 org 的图；函数属主能在上面跑 openCypher", async () => {
    const graph = await asApp(ORG, async (c) => (await c.query<{ g: string }>("SELECT kg_ensure_current_org_graph() AS g")).rows[0]!.g);
    // 读写由后续 feature 的 SECURITY DEFINER 函数承担；这里只证明「图在、AGE 在这个库里能执行」。
    const n = await asOwner(async (c) => {
      // AGE 的属性匹配（`{k: 'f01'}`）会生成 `agtype @> agtype`，该运算符住在 ag_catalog；
      // 后续 feature 的 SECURITY DEFINER 函数同样要把 ag_catalog 放进固定 search_path。
      await c.query('SET search_path = ag_catalog, "$user", public');
      await c.query(`SELECT * FROM ag_catalog.cypher('${graph}', $$ CREATE (:Probe {k: 'f01'}) $$) AS (v ag_catalog.agtype)`);
      const r = await c.query<{ n: string }>(
        `SELECT n::text FROM ag_catalog.cypher('${graph}', $$ MATCH (p:Probe {k: 'f01'}) RETURN count(p) $$) AS (n ag_catalog.agtype)`,
      );
      return Number(r.rows[0]!.n);
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
