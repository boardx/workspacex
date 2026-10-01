/**
 * Issue #4270 —— AGE 图里不能有重复边：投影与 canonical 的活边逐条一一对应（按**多重集**比，不是按集合比）。
 *
 * 根因（迁移 20260926130000 的文件头有完整说明）：F04 的 kg_age_put_edge 用一条 cypher 同时做
 * `MERGE (a) SET … MERGE (b) SET … CREATE (a)-[]->(b)`。端点已经在图里时，SET 会就地改写顶点行，而同一条语句里
 * 对 N 的扫描有时会再看到这行的新版本（Halloween 问题），MERGE 于是多产出一行，CREATE 就建出两条同 id 的边。
 * 全量重建先建好全部顶点再写边，所以每条边都走这个分支；增量投影里端点已存在的边同样会中。
 * F04 的对拍（graphParity）把两边各转成 Set 再比，两条一模一样的边在 Set 里是一条，于是一直没被看见。
 *
 * 本文件用一个「枢纽」夹具（1 个实体挂 HUB_CLAIMS 条结论，每条一条边）在真实 AGE 上复现，并钉住：
 *   ① 增量投影排空后、② 重建后、③ 连续重建两次后、④ 重建与增量投影并发之后——图里的边与 kg_live_edges 按多重集相等；
 *   ⑤ 对拍按多重集比：人为造一条重复边，graphParity 必须报出来；
 *   ⑥ 已有的重复边有幂等的清理：kg_age_dedupe_edges 删掉多出来的副本（迁移对每个已有图跑一次），再跑一次什么也不删。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { graphParity, rebuildOrgGraph } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "org-kg-i4270-dup";
const HUB_CLAIMS = 300;
let db: PgDatabase;
let projection: PgGraphProjection;
const silent = { info: () => undefined, error: () => undefined };

/** 插入 [from, to] 号结论，各带一条 `about` 边指向枢纽实体；g % 4 = 0 的再指向第二个实体。触发器会把它们排进 outbox。 */
async function addClaims(from: number, to: number): Promise<void> {
  await asOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
    await c.query(`INSERT INTO claims (id, org_id, statement, status, scope_kind, scope_id, created_by)
      SELECT $1 || '-c-' || g, $1, 'claim ' || g, 'proposed', 'org', $1, 'model' FROM generate_series($2::int, $3::int) g`,
    [ORG, from, to]);
    await c.query(`INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, scope_kind, scope_id, created_by)
      SELECT $1 || '-e-' || t || '-' || g, $1, 'claim', $1 || '-c-' || g, 'object', $1 || '-o-' || t, 'about', 'org', $1, 'model'
        FROM generate_series($2::int, $3::int) g, unnest(ARRAY['hub', 'side']) t
       WHERE t = 'hub' OR g % 4 = 0`, [ORG, from, to]);
    await c.query("COMMIT");
  });
}

/** 投影 worker 跑到本 org 的 outbox 排空。 */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await projectPendingGraph(projection, silent);
    if (!(await projection.pendingOrgs()).includes(ORG as never)) return;
  }
  throw new Error("outbox did not drain");
}

/** 图里每条边的 id（有几条就出现几次）与 canonical 活边的 id，都排好序：两者相等 ⇔ 按多重集相等。 */
async function edgeMultisets(): Promise<{ graph: string[]; canonical: string[] }> {
  return asOwner(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      await c.query("SET LOCAL search_path = ag_catalog, public");
      const g = (await c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [ORG])).rows[0]!.g;
      const graph = (await c.query<{ id: string }>(`SELECT properties ->> 'id'::text AS id FROM "${g}"."E"`)).rows.map((r) => r.id);
      const canonical = (await c.query<{ id: string }>("SELECT id FROM kg_live_edges($1)", [ORG])).rows.map((r) => r.id);
      return { graph: graph.sort(), canonical: canonical.sort() };
    } finally {
      await c.query("COMMIT");
    }
  });
}

const duplicates = (xs: readonly string[]) => xs.filter((x, i) => i > 0 && xs[i - 1] === x);

async function expectOneToOne(label: string): Promise<void> {
  const { graph, canonical } = await edgeMultisets();
  expect(duplicates(graph), `${label}: duplicated edge ids in AGE`).toEqual([]);
  expect(graph.length, `${label}: AGE edge count vs canonical live edge count`).toBe(canonical.length);
  expect(graph, label).toEqual(canonical);
  const p = await asOwner(async (c) => {
    await c.query("BEGIN");
    try { return await graphParity(c, ORG); } finally { await c.query("COMMIT"); }
  });
  expect(p, label).toEqual({ missingInGraph: [], extraInGraph: [] });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await asOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("INSERT INTO organizations (id, name, kind) VALUES ($1, $1, 'organization')", [ORG]);
    await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
    await c.query(`INSERT INTO ontology_objects (id, org_id, scope_kind, scope_id, object_kind, name, created_by)
      SELECT $1 || '-o-' || x, $1, 'org', $1, 'concept', 'fixture ' || x, 'model' FROM unnest(ARRAY['hub', 'side']) x`, [ORG]);
    await c.query("COMMIT");
  });
  await addClaims(1, HUB_CLAIMS);
  db = new PgDatabase(appConfig());
  projection = new PgGraphProjection(db);
});
afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

describe("#4270: AGE 投影与 canonical 活边一一对应（多重集）", () => {
  it("① 增量投影排空后：没有重复边，条数与 canonical 相等", async () => {
    await drain();
    await expectOneToOne("incremental");
  });

  it("② graph:rebuild 之后：没有重复边，条数与 canonical 相等（重建返回的 edges 也是这个数）", async () => {
    const r = await asOwner((c) => rebuildOrgGraph(c, ORG));
    expect(r.parity).toEqual({ missingInGraph: [], extraInGraph: [] });
    const { canonical } = await edgeMultisets();
    expect(r.edges).toBe(canonical.length);
    await expectOneToOne("rebuild");
  });

  it("③ 连续重建两次（重放）：仍然一一对应", async () => {
    await asOwner((c) => rebuildOrgGraph(c, ORG));
    await asOwner((c) => rebuildOrgGraph(c, ORG));
    await expectOneToOne("rebuild twice");
  });

  it("④ 重建与增量投影并发：两边都跑完、outbox 排空后仍然一一对应", async () => {
    await addClaims(HUB_CLAIMS + 1, HUB_CLAIMS + 120);
    await Promise.all([
      asOwner((c) => rebuildOrgGraph(c, ORG)),
      projectPendingGraph(projection, silent),
      projectPendingGraph(projection, silent),
    ]);
    await addClaims(HUB_CLAIMS + 121, HUB_CLAIMS + 160);
    await Promise.all([projectPendingGraph(projection, silent), asOwner((c) => rebuildOrgGraph(c, ORG))]);
    await drain();
    await expectOneToOne("rebuild ∥ incremental");
  });

  it("⑤ 对拍按多重集比：图里多出一条一模一样的边，graphParity 报 extraInGraph（F04 按 Set 比时看不见）", async () => {
    const dupId = `${ORG}-e-hub-1`;
    await asOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("SET LOCAL search_path = ag_catalog, public");
      const g = (await c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [ORG])).rows[0]!.g;
      await c.query(`SELECT * FROM cypher('${g}', $$
        MATCH (a:N)-[e:E {id: '${dupId}'}]->(b:N) CREATE (a)-[:E {id: e.id, relation: e.relation}]->(b) RETURN 1 $$) AS (v agtype)`);
      await c.query("COMMIT");
    });
    const p = await asOwner(async (c) => {
      await c.query("BEGIN");
      try { return await graphParity(c, ORG); } finally { await c.query("COMMIT"); }
    });
    expect(p.missingInGraph).toEqual([]);
    expect(p.extraInGraph).toEqual([`E|${dupId}|claim:${ORG}-c-1|object:${ORG}-o-hub|about`]);
  });

  it("⑥ 已有重复边的清理：kg_age_dedupe_edges 删掉多出来的副本、幂等；清理后一一对应", async () => {
    const dedupe = () => asOwner(async (c) =>
      (await c.query<{ n: number }>("SELECT kg_age_dedupe_edges(kg_org_graph_name($1)) AS n", [ORG])).rows[0]!.n);
    expect(await dedupe()).toBe(1);
    expect(await dedupe()).toBe(0);
    await expectOneToOne("after dedupe");
  });

  it("⑦ 写边不是恰好一条就报错（fail closed）：端点不在图里时 KG_EDGE_PROJECTION，而不是悄悄少一条边", async () => {
    const put = () => asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SET LOCAL search_path = ag_catalog, public");
        const g = (await c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [ORG])).rows[0]!.g;
        await c.query(`SELECT * FROM cypher('${g}', $$ MATCH (n:N {key: 'object:${ORG}-o-side'}) DETACH DELETE n $$) AS (v agtype)`);
        // 重建模式（p_fresh）假定 object / claim 端点已由顶点那一轮建好；这里故意让它不在
        await c.query("SELECT public.kg_age_put_edge($1, le, true) FROM public.kg_live_edges($2) le WHERE le.id = $3",
          [g, ORG, `${ORG}-e-side-4`]);
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await expect(put()).rejects.toThrow(/KG_EDGE_PROJECTION: edge .*-e-side-4 was written 0 times/);
    await expectOneToOne("after rejected put (rolled back)");
  });
});
