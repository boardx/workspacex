/**
 * Phase 18 F04 —— 投影 worker：canonical 写入 → outbox → 本 org 的 AGE 图。
 *
 * - 写入路径不碰 AGE：执行器落表后图还不存在，outbox 里已经有待投影行
 * - worker 一轮之后 outbox 清空，图与 canonical 逐行一致
 * - 幂等：同一目标重复投影，图不变
 * - 顶点「死掉」（结论撤销）⇒ 顶点和它的边一起离开图
 * - 一个 org 投影失败（AGE 不可用）不影响别的 org；失败 org 的待投影行原样保留，恢复后补齐
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import type { GraphProjectionPort } from "../../src/application/knowledge-graph/ports";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { graphParity } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { KgProjectionWorker } from "../../src/infrastructure/knowledge-graph/kg-projection-worker";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { asApp, asOwner, resetOrgs } from "../support/db";
import { modelBatch, seedKgOrg } from "./kg-fixtures";

const ORG_A = "org-kg-f04-proj-a";
const ORG_B = "org-kg-f04-proj-b";
let segA: string;
let segB: string;
let db: PgDatabase;
let store: PgOntologyStore;
let projection: PgGraphProjection;
const errors: unknown[] = [];
const logger: LoggerPort = { info: () => undefined, error: (_m, f) => { errors.push(f.err); } };

beforeAll(async () => {
  ({ segments: [segA] } = await seedKgOrg(ORG_A));
  ({ segments: [segB] } = await seedKgOrg(ORG_B));
  await asOwner(async (c) => {
    for (const org of [ORG_A, ORG_B]) {
      const g = (await c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [org])).rows[0]!.g;
      await c.query("SELECT ag_catalog.drop_graph($1::name, true) FROM ag_catalog.ag_graph WHERE name = $1", [g]);
    }
  });
  db = new PgDatabase(appConfig());
  store = new PgOntologyStore(db);
  projection = new PgGraphProjection(db);
});
afterAll(async () => { await db.close(); });

const outbox = (org: string) =>
  asApp(org, (c) => c.query<{ target_kind: string; target_id: string }>(
    "SELECT target_kind, target_id FROM kg_projection_outbox ORDER BY target_kind, target_id",
  )).then((r) => r.rows);

const parity = (org: string) => asOwner(async (c) => {
  await c.query("BEGIN");
  try { return await graphParity(c, org); } finally { await c.query("COMMIT"); }
});

const graphExists = (org: string) => asOwner(async (c) =>
  (await c.query("SELECT 1 FROM ag_catalog.ag_graph WHERE name = kg_org_graph_name($1)", [org])).rows.length === 1);

describe("F04: 投影 worker", () => {
  it("写入路径不碰 AGE：落表后图还不存在，outbox 里是本批的三个目标", async () => {
    const b = modelBatch(ORG_A, segA);
    expect((await applyOntologyBatch(store, toOrgId(ORG_A), null, b)).outcome).toBe("accepted");
    expect(await graphExists(ORG_A)).toBe(false);
    expect(await outbox(ORG_A)).toEqual([
      { target_kind: "claim", target_id: b.claims[0]!.id },
      { target_kind: "edge", target_id: b.edges[0]!.id },
      { target_kind: "object", target_id: b.objects[0]!.id },
    ]);
  });

  it("worker 一轮：outbox 清空，图与 canonical 逐行一致", async () => {
    expect(await projection.pendingOrgs()).toContain(ORG_A);
    const r = await projectPendingGraph(projection, logger);
    expect(r.failedOrgs).toEqual([]);
    expect(r.projected).toBeGreaterThanOrEqual(3);
    expect(await outbox(ORG_A)).toEqual([]);
    const p = await parity(ORG_A);
    expect(p).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("幂等：同一批目标再排一次、再投一次，图不变、没有重复顶点或边", async () => {
    const before = await asOwner(async (c) => { await c.query("BEGIN"); await c.query("SELECT set_config('app.current_org',$1,true)", [ORG_A]);
      const r = (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() x")).rows.map((y) => y.x).sort(); await c.query("COMMIT"); return r; });
    // 改一个无关字段触发重新排队（触发器按目标排，不按变化内容）
    await asOwner((c) => c.query("UPDATE claims SET confidence = 0.9 WHERE org_id = $1 AND scope_kind IS NOT NULL", [ORG_A]));
    await asOwner((c) => c.query("UPDATE ontology_objects SET name = name WHERE org_id = $1", [ORG_A]));
    await projectPendingGraph(projection, logger);
    await projectPendingGraph(projection, logger);
    const after = await asOwner(async (c) => { await c.query("BEGIN"); await c.query("SELECT set_config('app.current_org',$1,true)", [ORG_A]);
      const r = (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() x")).rows.map((y) => y.x).sort(); await c.query("COMMIT"); return r; });
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });

  it("结论撤销 ⇒ 顶点和它的边一起离开图，对拍仍一致", async () => {
    const b = modelBatch(ORG_A, segA);
    await applyOntologyBatch(store, toOrgId(ORG_A), null, b);
    await projectPendingGraph(projection, logger);
    await asOwner((c) => c.query("UPDATE claims SET revoked_at = now(), revocation_reason = 'source_deleted' WHERE id = $1", [b.claims[0]!.id]));
    await projectPendingGraph(projection, logger);
    const snap = await asOwner(async (c) => { await c.query("BEGIN"); await c.query("SELECT set_config('app.current_org',$1,true)", [ORG_A]);
      const r = (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() x")).rows.map((y) => y.x); await c.query("COMMIT"); return r; });
    expect(snap.some((x) => x.includes(b.claims[0]!.id))).toBe(false);
    expect(snap).toContain(`V|object:${b.objects[0]!.id}`);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("没有作用域的旧行不排队（phase-01 的检索写入不进图）", async () => {
    await asApp(ORG_A, (c) => c.query(
      "INSERT INTO claims (id, org_id, statement, status, tsv) VALUES ('c-f04-legacy', $1, '旧', 'proposed', ''::tsvector)", [ORG_A],
    ));
    expect((await outbox(ORG_A)).some((r) => r.target_id === "c-f04-legacy")).toBe(false);
  });

  it("一个 org 的 AGE 不可用：它失败、别的 org 照常投；它的待投影行保留，恢复后补齐", async () => {
    const a = modelBatch(ORG_A, segA);
    const bb = modelBatch(ORG_B, segB);
    await applyOntologyBatch(store, toOrgId(ORG_A), null, a);
    await applyOntologyBatch(store, toOrgId(ORG_B), null, bb);
    const broken: GraphProjectionPort = {
      pendingOrgs: () => projection.pendingOrgs(),
      projectPending: (org: OrgId, limit: number) =>
        org === ORG_A ? Promise.reject(new Error("cypher query failed: simulated AGE outage")) : projection.projectPending(org, limit),
    };
    errors.length = 0;
    const r = await projectPendingGraph(broken, logger);
    expect(r.failedOrgs).toEqual([ORG_A]);
    expect(errors).toHaveLength(1);
    expect((await outbox(ORG_A)).length).toBe(3);
    expect(await outbox(ORG_B)).toEqual([]);
    expect(await parity(ORG_B)).toEqual({ missingInGraph: [], extraInGraph: [] });

    await projectPendingGraph(projection, logger);  // 恢复
    expect(await outbox(ORG_A)).toEqual([]);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("库里没有 AGE（桌面版）：不算故障，只记一条 info，不刷 error；worker 进入退避", async () => {
    const noAge: GraphProjectionPort = {
      pendingOrgs: async () => [toOrgId(ORG_A), toOrgId(ORG_B)],
      projectPending: () => Promise.reject(new Error("KG_GRAPH_UNAVAILABLE: Apache AGE is not installed in this database")),
    };
    const infos: string[] = [];
    errors.length = 0;
    const r = await projectPendingGraph(noAge, { info: (m) => { infos.push(m); }, error: (_m, f) => { errors.push(f.err); } });
    expect(r).toMatchObject({ graphUnavailable: true, projected: 0 });
    expect(errors).toEqual([]);
    expect(infos).toHaveLength(1);

    const worker = new KgProjectionWorker(noAge, { info: () => undefined, error: () => undefined });
    expect((await worker.runOnce())?.graphUnavailable).toBe(true);
    expect(await worker.runOnce()).toBeNull();  // 退避中
  });

  it("app_rw 不能直接写 outbox（只有触发器能排队）", async () => {
    await expect(asApp(ORG_A, (c) => c.query(
      "INSERT INTO kg_projection_outbox (org_id, target_kind, target_id) VALUES ($1, 'claim', 'x')", [ORG_A],
    ))).rejects.toThrow(/permission denied/);
  });
});

describe("F04 评审补强", () => {
  const openApp = async (org: string) => {
    const c = new pg.Client(appConfig());
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true)", [org]);
    return c;
  };

  it("投影进行中到达的新变动不会被这一轮删掉（outbox 不丢更新）", async () => {
    const b = modelBatch(ORG_A, segA);
    await applyOntologyBatch(store, toOrgId(ORG_A), null, b);
    const worker = await openApp(ORG_A);
    try {
      await worker.query("SELECT kg_project_pending(500)");   // 锁住、投影、删到本轮最大 id
      // 并发写入：没有唯一约束可撞，不会被 worker 的行锁挡住，也不会被 DO NOTHING 吞掉
      await asOwner((c) => c.query("UPDATE claims SET revoked_at = now(), revocation_reason = 'source_deleted' WHERE id = $1", [b.claims[0]!.id]));
      await worker.query("COMMIT");
    } finally {
      await worker.end();
    }
    expect((await outbox(ORG_A)).some((r) => r.target_id === b.claims[0]!.id)).toBe(true);
    await projectPendingGraph(projection, logger);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("数据库层的 AGE 故障（图表被锁、超时）：canonical 照常，待投影行保留，恢复后补齐", async () => {
    const b = modelBatch(ORG_A, segA);
    await applyOntologyBatch(store, toOrgId(ORG_A), null, b);
    const graph = (await asOwner((c) => c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [ORG_A]))).rows[0]!.g;
    const locker = new pg.Client((await import("../../src/infrastructure/db/pg-config")).migrationConfig());
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query(`LOCK TABLE "${graph}"."N" IN ACCESS EXCLUSIVE MODE`);
    try {
      const w = await openApp(ORG_A);
      try {
        await w.query("SET LOCAL lock_timeout = '300ms'");
        await w.query("SELECT kg_project_pending(500)").catch(() => undefined);
        await w.query("COMMIT").catch(() => undefined);
      } finally {
        await w.end();
      }
      expect((await outbox(ORG_A)).some((r) => r.target_id === b.claims[0]!.id)).toBe(true);
      const canonical = await asApp(ORG_A, (c) => c.query("SELECT 1 FROM claims WHERE id = $1", [b.claims[0]!.id]));
      expect(canonical.rows).toHaveLength(1);
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }
    await projectPendingGraph(projection, logger);
    expect(await outbox(ORG_A)).toEqual([]);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("指向片段的边被删 ⇒ 孤立的片段顶点一起清掉（对拍连源顶点一起比）", async () => {
    const b = modelBatch(ORG_A, segA);
    const edge = { id: `${b.edges[0]!.id}-seg`, srcKind: "claim" as const, srcId: b.claims[0]!.id, dstKind: "segment" as const, dstId: segA, relation: "derived_from" as const };
    await applyOntologyBatch(store, toOrgId(ORG_A), null, { ...b, edges: [...b.edges, edge] });
    await projectPendingGraph(projection, logger);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
    // 删掉所有指向该片段的边
    await asOwner((c) => c.query("DELETE FROM ontology_edges WHERE org_id = $1 AND dst_kind = 'segment'", [ORG_A]));
    await projectPendingGraph(projection, logger);
    expect(await parity(ORG_A)).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("org 删除 ⇒ 它的图一起删", async () => {
    const graph = (await asOwner((c) => c.query<{ g: string }>("SELECT kg_org_graph_name($1) AS g", [ORG_B]))).rows[0]!.g;
    expect(await graphExists(ORG_B)).toBe(true);
    await resetOrgs(ORG_B);
    const left = await asOwner((c) => c.query("SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1", [graph]));
    expect(left.rows).toHaveLength(0);
  });
});

