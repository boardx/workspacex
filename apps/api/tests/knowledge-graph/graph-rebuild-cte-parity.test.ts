/**
 * Phase 18 F04 —— 「AGE 是可重建投影」的机械证据（00-overview R4-2，ADR-114 决策 2）。
 *
 * 用纯 SQL 从 canonical 重算「应该在图里的」（kg_canonical_snapshot，建在 kg_live_vertices /
 * kg_live_edges 上），与 AGE 上 openCypher 查出来的（kg_graph_snapshot）逐行对拍。
 * 图被弄坏 / 删掉之后，graph:rebuild 必须让两边重新逐行相等。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { graphParity, rebuildOrgGraph } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { asOwner } from "../support/db";
import { modelBatch, seedKgOrg } from "./kg-fixtures";

const ORG = "org-kg-f04-rebuild";
const OTHER = "org-kg-f04-rebuild-other";
const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
let db: PgDatabase;
const silent = { info: () => undefined, error: () => undefined };

beforeAll(async () => {
  const { segments: [seg, seg2] } = await seedKgOrg(ORG);
  const { segments: [otherSeg] } = await seedKgOrg(OTHER);
  db = new PgDatabase(appConfig());
  const store = new PgOntologyStore(db);
  const org = toOrgId(ORG);
  // 会话作用域 × 2 批、两个人的个人空间各 1 批、另一个 org 1 批
  await applyOntologyBatch(store, org, null, modelBatch(ORG, seg));
  const second = modelBatch(ORG, seg2);
  await applyOntologyBatch(store, org, null, {
    ...second,
    edges: [...second.edges, { id: `${second.edges[0]!.id}-src`, srcKind: "claim", srcId: second.claims[0]!.id, dstKind: "segment", dstId: seg2, relation: "derived_from" }],
  });
  for (const u of ["u-f04-1", "u-f04-2"]) {
    await applyOntologyBatch(store, org, u, modelBatch(ORG, seg, {
      scope: { kind: "personal", id: u }, actor: { kind: "human", id: u }, sourceRef: null, pipelineVersion: null,
    }));
  }
  await applyOntologyBatch(store, toOrgId(OTHER), null, modelBatch(OTHER, otherSeg));
  await projectPendingGraph(new PgGraphProjection(db), silent);
});
afterAll(async () => { await db.close(); });

const tx = <T>(fn: (c: import("pg").Client) => Promise<T>) => asOwner(async (c) => {
  await c.query("BEGIN");
  try { const r = await fn(c); await c.query("COMMIT"); return r; } catch (e) { await c.query("ROLLBACK"); throw e; }
});

const cypher = (graphOrg: string, q: string) => tx(async (c) => {
  await c.query('SET LOCAL search_path = ag_catalog, "$user", public');
  const g = (await c.query<{ g: string }>("SELECT public.kg_org_graph_name($1) AS g", [graphOrg])).rows[0]!.g;
  await c.query(`SELECT * FROM cypher('${g}', $$ ${q} $$) AS (v agtype)`);
});

describe("F04: graph:rebuild 与 CTE 对拍", () => {
  it("增量投影之后，两边已经逐行相等；个人空间两个人的行都在图里（图只有 id，可见性回 canonical 判）", async () => {
    const p = await tx((c) => graphParity(c, ORG));
    expect(p).toEqual({ missingInGraph: [], extraInGraph: [] });
    const canonical = await tx(async (c) => {
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      return (await c.query<{ x: string }>("SELECT x FROM kg_canonical_snapshot() x")).rows.map((r) => r.x);
    });
    // 3 批会话 + 2 批个人 = 每批 1 实体 1 结论 ⇒ 8 个顶点；边 4 + 1 条到片段 = 5
    expect(canonical.filter((x) => x.startsWith("V|"))).toHaveLength(8);
    expect(canonical.filter((x) => x.startsWith("E|"))).toHaveLength(5);
    expect(canonical.some((x) => x.includes(OTHER))).toBe(false);
  });

  it("图被弄坏（少一个顶点、多一条假边）⇒ 对拍能发现；graph:rebuild 之后重新逐行相等", async () => {
    await cypher(ORG, "MATCH (n:N {kind: 'object'}) WITH n LIMIT 1 DETACH DELETE n RETURN 1");
    await cypher(ORG, "MATCH (a:N {kind: 'claim'}) WITH a LIMIT 1 CREATE (a)-[:E {id: 'bogus', relation: 'about'}]->(a) RETURN 1");
    const broken = await tx((c) => graphParity(c, ORG));
    expect(broken.missingInGraph.length).toBeGreaterThan(0);
    expect(broken.extraInGraph.some((x) => x.startsWith("E|bogus|"))).toBe(true);

    const r = await asOwner((c) => rebuildOrgGraph(c, ORG));
    expect(r.parity).toEqual({ missingInGraph: [], extraInGraph: [] });
    expect({ vertices: r.vertices, edges: r.edges }).toEqual({ vertices: 8, edges: 5 });
  });

  it("图整张没了（例如 AGE 数据丢失）⇒ 从 canonical 重建出同一张图", async () => {
    await tx((c) => c.query("SELECT ag_catalog.drop_graph(kg_org_graph_name($1)::name, true)", [ORG]));
    const r = await asOwner((c) => rebuildOrgGraph(c, ORG));
    expect(r.parity).toEqual({ missingInGraph: [], extraInGraph: [] });
    expect(r.vertices).toBe(8);
  });

  it("重建一个 org 不碰另一个 org 的图", async () => {
    const before = await tx((c) => graphParity(c, OTHER));
    await asOwner((c) => rebuildOrgGraph(c, ORG));
    expect(await tx((c) => graphParity(c, OTHER))).toEqual(before);
    expect(before).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("`pnpm graph:rebuild --org` 脚本：对拍一致时退出码 0 并打印 ✓", () => {
    const out = execFileSync("pnpm", ["exec", "tsx", "scripts/graph-rebuild.ts", "--org", ORG], { cwd: API_DIR, encoding: "utf8" });
    expect(out).toContain(`✓ ${ORG}: vertices=8 edges=5`);
    expect(out).toContain("0 mismatch(es)");
  });
});
