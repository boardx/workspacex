/**
 * Phase 18 F07 —— 删除消息 / 会话的失效级联（uc-18-5 R3 ② ③，V1–V4），真实数据库 + 真 AGE。
 *
 * V1 删掉唯一来源的那条消息 ⇒ 结论 revoked_at 非空、source_deleted，边软失效，canonical 立刻不再给出它，AGE 投影后也没有。
 * V2 两个来源删掉一个 ⇒ 结论还在，证据 2 → 1。
 * V3 AGE 没跟上（投影 worker 没跑）⇒ canonical 已经过滤掉；投影之后图与 canonical 一致。
 * V4 L0 结论失效 ⇒ 由它晋升的 L1 副本同时失效；合并了另一个仍有效来源的 L1 副本保留。
 * 另：整个会话被删（chat 的 deleteThread，外键级联掉全部消息）⇒ 会话里的结论全部失效。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import type { OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { graphParity } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { silentLogger } from "./kg-extraction-fixtures";

const ORG = "org-kg-f07-cascade";
const ORG_ID = toOrgId(ORG);
const T = "thr-kg-f07-main";
const T2 = "thr-kg-f07-doomed";
let db: PgDatabase;
let store: PgOntologyStore;
const q = <T>(sql: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(sql, params)).rows as T[]);
const project = () => projectPendingGraph(new PgGraphProjection(db), silentLogger);
const live = async () => (await q<{ key: string }>("SELECT key FROM kg_live_vertices($1)", [ORG])).map((r) => r.key);
const graph = () => asOwner(async (c) => {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
    return (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() AS x")).rows.map((r) => r.x);
  } finally { await c.query("COMMIT"); }
});
const parity = () => asOwner(async (c) => {
  await c.query("BEGIN");
  try { return await graphParity(c, ORG); } finally { await c.query("COMMIT"); }
});
const claimRow = async (id: string) => (await q<{ status: string; revocation_reason: string | null; revoked: boolean }>(
  "SELECT status, revocation_reason, revoked_at IS NOT NULL AS revoked FROM claims WHERE id = $1", [id]))[0];
const msg = (messageId: string, excerpt: string) => ({ messageId, stance: "supporting" as const, excerpt });

function batch(id: string, scope: OntologyBatch["scope"], actor: OntologyBatch["actor"], claims: OntologyBatch["claims"], edges: OntologyBatch["edges"] = []): OntologyBatch {
  return { actionId: `act-${id}`, scope, actor, actionType: "extract", sourceRef: `src-${id}`, pipelineVersion: "kg-extract@1", objects: [], claims, edges };
}
const model = { kind: "model" as const, id: "kg-extractor" };
const session = (id: string) => ({ kind: "chat_session" as const, id });
const claim = (id: string, statement: string, evidence: ReturnType<typeof msg>[]) =>
  ({ id, claimKind: "fact" as const, statement, status: "proposed" as const, confidence: 0.8, evidence });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addChatThread({ orgId: ORG, id: T, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: T2, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  const say = (id: string, threadId: string, body: string) => addChatMessage({ orgId: ORG, id, threadId, body, authorId: "u-owner" });
  await say("m1", T, "张三决定下周一上线 v2");
  await say("m2", T, "测试环境不稳定");
  await say("m3", T, "测试环境确实不稳定");
  await say("m4", T2, "预算已经批了");
  db = new PgDatabase(appConfig());
  store = new PgOntologyStore(db);
  const apply = async (b: OntologyBatch, user: string | null = null) => {
    const r = await applyOntologyBatch(store, ORG_ID, user, b);
    if (r.outcome !== "accepted") throw new Error(JSON.stringify(r));
  };
  await apply(batch("c1", session(T), model, [claim("c1", "张三决定下周一上线 v2", [msg("m1", "张三决定下周一上线 v2")])]));
  await apply(batch("c2", session(T), model, [claim("c2", "测试环境不稳定", [msg("m2", "测试环境不稳定"), msg("m3", "测试环境确实不稳定")])]));
  await apply(batch("c4", session(T2), model, [claim("c4", "预算已经批了", [msg("m4", "预算已经批了")])]));
  // L1：p1 只从 c1 晋升；p12 合并了 c1 与 c2 两个来源
  const human = { kind: "human" as const, id: "u-owner" };
  const personal = { kind: "personal" as const, id: "u-owner" };
  const derived = (id: string, src: string, dst: string) => ({ id, srcKind: "claim" as const, srcId: src, dstKind: "claim" as const, dstId: dst, relation: "derived_from" as const });
  await apply(batch("p1", personal, human, [{ ...claim("p1", "张三决定下周一上线 v2", [msg("m1", "张三决定下周一上线 v2")]), status: "accepted" }], [derived("d-p1", "p1", "c1")]), "u-owner");
  await apply(batch("p12", personal, human, [{ ...claim("p12", "v2 上线与测试环境", [msg("m1", "张三决定下周一上线 v2"), msg("m2", "测试环境不稳定")]), status: "accepted" }],
    [derived("d-p12-a", "p12", "c1"), derived("d-p12-b", "p12", "c2")]), "u-owner");
  await project();
});
afterAll(async () => { await db.close(); });

describe("F07: 删除消息 / 会话的失效级联", () => {
  it("V3 前半 + V1：删掉 m1，canonical 立刻不再给出 c1（AGE 还没跟上，图里仍是旧的）", async () => {
    expect(await graph()).toEqual(expect.arrayContaining([expect.stringContaining("c1")]));
    await asApp(ORG, (c) => c.query("DELETE FROM chat_messages WHERE id = 'm1'"));
    expect(await claimRow("c1")).toEqual({ status: "superseded", revocation_reason: "source_deleted", revoked: true });
    expect(await live()).not.toContain("claim:c1");
    // 投影还没跑：图里的 c1 是滞后的——召回以 canonical 为准，所以不会漏出
    expect((await graph()).some((x) => x.includes("c1"))).toBe(true);
  });

  it("V4：c1 失效 ⇒ 只从它晋升的 p1 同时失效；p12 还有 c2 这个有效来源，保留", async () => {
    expect(await claimRow("p1")).toMatchObject({ status: "superseded", revoked: true });
    expect(await claimRow("p12")).toMatchObject({ revoked: false });
    // p12 失去的是 m1 那条证据；m2 还在
    expect(await q("SELECT message_id FROM claim_message_evidence WHERE claim_id = 'p12'")).toEqual([{ message_id: "m2" }]);
  });

  it("V1 边：连着 c1 / p1 的边全部软失效（行还在），p12 → c2 的来源边仍有效", async () => {
    const edges = await q<{ id: string; status: string }>("SELECT id, status FROM ontology_edges WHERE org_id = $1 ORDER BY id", [ORG]);
    expect(edges).toEqual([
      { id: "d-p1", status: "invalidated" },
      { id: "d-p12-a", status: "invalidated" },
      { id: "d-p12-b", status: "active" },
    ]);
  });

  it("V3 后半：投影之后图与 canonical 逐行一致，c1 / p1 不在图里", async () => {
    await project();
    expect(await parity()).toEqual({ missingInGraph: [], extraInGraph: [] });
    const g = await graph();
    expect(g.some((x) => /\bc1\b|\bp1\b/.test(x))).toBe(false);
  });

  it("V2：c2 两个来源删掉一个 ⇒ 结论还在，证据 2 → 1", async () => {
    await asApp(ORG, (c) => c.query("DELETE FROM chat_messages WHERE id = 'm3'"));
    expect(await claimRow("c2")).toMatchObject({ revoked: false });
    expect(await q("SELECT message_id FROM claim_message_evidence WHERE claim_id = 'c2'")).toEqual([{ message_id: "m2" }]);
  });

  it("整个会话被删（chat deleteThread）⇒ 会话里的结论全部失效，原因 source_deleted", async () => {
    const [row] = await q<{ version: number }>("SELECT version FROM chat_threads WHERE id = $1", [T2]);
    expect(await new PgChatRepository(db).deleteThread(ORG_ID, T2, row!.version)).toEqual({ messageCount: 1 });
    expect(await claimRow("c4")).toEqual({ status: "superseded", revocation_reason: "source_deleted", revoked: true });
    await project();
    expect(await parity()).toEqual({ missingInGraph: [], extraInGraph: [] });
  });

  it("证据被删之外的更新不触发失效：给还活着的结论改状态不连带任何边", async () => {
    const before = await q("SELECT id, status FROM ontology_edges WHERE org_id = $1 ORDER BY id", [ORG]);
    await q("UPDATE claims SET status = 'reviewed' WHERE id = 'c2'");
    expect(await q("SELECT id, status FROM ontology_edges WHERE org_id = $1 ORDER BY id", [ORG])).toEqual(before);
  });
});
