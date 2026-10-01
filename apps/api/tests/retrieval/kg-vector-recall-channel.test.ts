/**
 * Phase 18 S9（#4366，epic #4359）—— 结论 / 实体的嵌入流水线 + 召回的向量通道（真库 + 真抽取 + 回环嵌入器）。
 *
 * 北极星：换了一种说法问之前说过的事，新会话里照样记得（不必重新交代背景）。
 *   ① 写入即排队：结论 / 实体一落表就进 kg_embedding_outbox；worker 一轮把它们嵌入进 object_embeddings；
 *   ② 文本变了 ⇒ 旧向量立刻删掉、重新排队；取出之后文本又变了 ⇒ 写回被拒（不写旧文本的向量）；
 *   ③ 召回：字面零重合的换说法，经向量通道召回；没配置嵌入模型时召不回（通道未启用、不提醒）；
 *   ④ 权限：向量只在候选集里找，而且即便伪造候选 id，别人个人空间的向量也读不到（RLS target_visible）；
 *   ⑤ 降级：嵌入服务挂了 / 模型没登记 ⇒ 这一轮只用字面 + 图，材料里如实说「相似查询暂不可用」；
 *      worker 遇到服务不可用不计失败次数、outbox 行保留。
 *
 * 嵌入器是确定性的回环实现（kg-vector-fixtures.ts），不调任何真实模型。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEmbeddingTick } from "../../src/application/knowledge-graph/embed-pending-knowledge";
import type { KgEmbeddingQueuePort } from "../../src/application/knowledge-graph/ports";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { buildKnowledgeContextMessage, VECTOR_RECALL_DEGRADED_NOTICE } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKgEmbeddingQueue } from "../../src/infrastructure/knowledge-graph/pg-kg-embedding";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "../knowledge-graph/kg-extraction-fixtures";
import { LOOPBACK_DIMS, LoopbackEmbedding, loopbackEmbed } from "../knowledge-graph/kg-vector-fixtures";
import { addChatMessage } from "../support/chat-db";
import { asOwner } from "../support/db";
import { registerEmbeddingModel } from "../support/retrieval-fixtures";
import { DEMAND, seedL1Org, type L1Org } from "./kg-l1-fixtures";

const ORG = "org-kg-s9-vector";
const orgId = toOrgId(ORG);
/** 与 DEMAND（「客户 A 要求 v2 下周一上线」）字面几乎不重合（二字组只共享「客户」一个，远低于字面线），说的是同一件事。 */
const PARAPHRASE = "那家客户的新版本希望什么时候发布？";
let db: PgDatabase;
let fx: L1Org;
let embedder: LoopbackEmbedding;
let queue: PgKgEmbeddingQueue;
const noLog = () => undefined;

/** 共享测试库里别的测试文件也在写结论：worker 只处理本文件的 org。 */
const scoped = (q: KgEmbeddingQueuePort): KgEmbeddingQueuePort => ({
  pendingOrgs: async () => (await q.pendingOrgs()).filter((o) => o === orgId),
  pending: (...a) => q.pending(...a), write: (...a) => q.write(...a), fail: (...a) => q.fail(...a), deadCount: () => q.deadCount(),
});
async function drain(e: LoopbackEmbedding = embedder): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const r = await runEmbeddingTick({ queue: scoped(queue), embeddings: e, logger: silentLogger });
    if (r.processed === 0 || r.providerUnavailable) return;
  }
}
const recall = (port: PgKnowledgeRecall, threadId: string, query: string, userId = "u-owner") =>
  recallThreadKnowledge(port, { orgId, userId, threadId, query }, noLog);
async function vectorRows(): Promise<{ target_kind: string; target_id: string }[]> {
  return asOwner(async (c) => (await c.query<{ target_kind: string; target_id: string }>(
    "SELECT target_kind, target_id FROM object_embeddings WHERE org_id = $1 AND model = $2 ORDER BY 1, 2", [ORG, embedder.model])).rows);
}
async function liveTargets(): Promise<{ target_kind: string; target_id: string }[]> {
  return asOwner(async (c) => (await c.query<{ target_kind: string; target_id: string }>(
    `SELECT 'claim' AS target_kind, id AS target_id FROM claims
      WHERE org_id = $1 AND scope_kind IS NOT NULL AND revoked_at IS NULL AND status <> 'superseded'
     UNION ALL
     SELECT 'object', id FROM ontology_objects WHERE org_id = $1 AND scope_kind IS NOT NULL AND merged_into IS NULL
     ORDER BY 1, 2`, [ORG])).rows);
}
async function outbox(kind: string, id: string): Promise<number> {
  return asOwner(async (c) => Number((await c.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM kg_embedding_outbox WHERE org_id = $1 AND target_kind = $2 AND target_id = $3", [ORG, kind, id])).rows[0]!.n));
}

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  fx = await seedL1Org(db, ORG);
  embedder = new LoopbackEmbedding();
  queue = new PgKgEmbeddingQueue(db);
  // 登记模型（运维动作）⇒ 已有的活结论 / 实体补排一次（迁移 20260927200000 的触发器）。
  await registerEmbeddingModel(embedder.model, embedder.modelVersion, LOOPBACK_DIMS);
  await drain();
});
afterAll(async () => { await db.close(); });

describe("S9 ①② 嵌入流水线：写入即排队，文本变了就换向量", () => {
  it("登记模型后，本 org 每一条活结论、每一个活实体都有了向量，outbox 清空", async () => {
    const live = await liveTargets();
    expect(live.some((t) => t.target_kind === "claim")).toBe(true);
    expect(live.some((t) => t.target_kind === "object")).toBe(true);
    expect(await vectorRows()).toEqual(live);
    const left = await asOwner(async (c) => Number((await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM kg_embedding_outbox WHERE org_id = $1", [ORG])).rows[0]!.n));
    expect(left).toBe(0);
  });

  it("新说的一句话 ⇒ 抽取落表的新结论立刻排队，worker 一轮后有向量（向量就是这句话的嵌入）", async () => {
    await addChatMessage({ orgId: ORG, id: `m-${fx.A}-budget`, threadId: fx.A, body: "这个项目的预算是 50 万。", authorId: "u-owner" });
    const reply = JSON.stringify({ entities: [], claims: [{ statement: "项目预算是 50 万", kind: "fact", confidence: 0.9, about: [], decidedBy: null, quote: "预算是 50 万" }] });
    await enableExtraction(ORG);
    await runExtractionTick(extractionDeps(db, loopbackModel([["预算", reply]]).model, ORG));
    const [c] = await asOwner(async (x) => (await x.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND statement = '项目预算是 50 万'", [ORG])).rows);
    expect(await outbox("claim", c!.id)).toBe(1);
    await drain();
    expect(await outbox("claim", c!.id)).toBe(0);
    const [v] = await asOwner(async (x) => (await x.query<{ e: string }>(
      "SELECT embedding::text AS e FROM object_embeddings WHERE target_kind = 'claim' AND target_id = $1 AND model = $2", [c!.id, embedder.model])).rows);
    const got = JSON.parse(v!.e) as number[];
    loopbackEmbed("项目预算是 50 万").forEach((x, i) => expect(got[i]).toBeCloseTo(x, 5));
  });

  it("结论的说法被改了 ⇒ 旧向量立刻删掉（同一事务）、重新排队；worker 之后按新说法嵌入", async () => {
    const [c] = await asOwner(async (x) => (await x.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND statement = '项目预算是 50 万'", [ORG])).rows);
    await asOwner((x) => x.query("UPDATE claims SET statement = '项目预算是 60 万' WHERE id = $1", [c!.id]));
    expect((await vectorRows()).some((r) => r.target_id === c!.id)).toBe(false);
    expect(await outbox("claim", c!.id)).toBe(1);
    await drain();
    const [v] = await asOwner(async (x) => (await x.query<{ e: string }>(
      "SELECT embedding::text AS e FROM object_embeddings WHERE target_kind = 'claim' AND target_id = $1", [c!.id])).rows);
    const got = JSON.parse(v!.e) as number[];
    loopbackEmbed("项目预算是 60 万").forEach((x, i) => expect(got[i]).toBeCloseTo(x, 5));
  });

  it("取出之后文本又变了 ⇒ 写回被拒（stale），不写旧文本的向量；新排的那行留给下一轮", async () => {
    const [c] = await asOwner(async (x) => (await x.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND statement = '项目预算是 60 万'", [ORG])).rows);
    await asOwner((x) => x.query("UPDATE claims SET statement = '项目预算是 70 万' WHERE id = $1", [c!.id]));
    const [t] = (await queue.pending(orgId, 64)).filter((x) => x.targetId === c!.id);
    expect(t!.content).toBe("项目预算是 70 万");
    await asOwner((x) => x.query("UPDATE claims SET statement = '项目预算是 80 万' WHERE id = $1", [c!.id]));
    expect(await queue.write(orgId, t!, embedder, loopbackEmbed(t!.content))).toBe("stale");
    expect((await vectorRows()).some((r) => r.target_id === c!.id)).toBe(false);
    expect(await outbox("claim", c!.id)).toBe(1);
    await drain();
    expect((await vectorRows()).some((r) => r.target_id === c!.id)).toBe(true);
  });
});

describe("S9 ③④ 召回的向量通道", () => {
  it("新会话 B 里换一种说法问：没有向量通道召不回；有向量通道经「相似」召回，来源仍是个人空间", async () => {
    const without = await recall(new PgKnowledgeRecall(db), fx.B, PARAPHRASE);
    expect(without.items.map((i) => i.claim.statement)).not.toContain(DEMAND);
    expect(without.plan.find((p) => p.channel === "vector")).toMatchObject({ available: false, hitCount: 0 });
    expect(without.degraded).toEqual([]);

    const r = await recall(new PgKnowledgeRecall(db, embedder), fx.B, PARAPHRASE);
    const hit = r.items.find((i) => i.claim.statement === DEMAND);
    expect(hit).toMatchObject({ claim: { id: fx.personalClaimId, scope: "personal" }, channels: ["vector"] });
    expect(r.plan.find((p) => p.channel === "vector")).toMatchObject({ available: true, weight: 1 });
    expect(r.plan.find((p) => p.channel === "vector")!.hitCount).toBeGreaterThanOrEqual(1);
    expect(buildKnowledgeContextMessage(r)).toContain(DEMAND);
  });

  it("伪造候选 id 也读不到别人个人空间的向量（object_embeddings 的 target_visible 策略）；本人读得到", async () => {
    const port = new PgKnowledgeRecall(db, embedder);
    expect(await port.vectorNeighbors(orgId, "u-member", PARAPHRASE, [fx.personalClaimId], 8)).toEqual([]);
    const own = await port.vectorNeighbors(orgId, "u-owner", PARAPHRASE, [fx.personalClaimId], 8);
    expect(own!.map((h) => h.claimId)).toEqual([fx.personalClaimId]);
    expect(own![0]!.similarity).toBeGreaterThan(0.35);
  });

  it("只在候选集里找：不在候选 id 里的结论即使更像也不返回；空候选集 ⇒ 不嵌入、不查", async () => {
    const port = new PgKnowledgeRecall(db, embedder);
    const [other] = await asOwner(async (x) => (await x.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND statement = '项目预算是 80 万'", [ORG])).rows);
    const hits = await port.vectorNeighbors(orgId, "u-owner", PARAPHRASE, [other!.id], 8);
    expect(hits!.map((h) => h.claimId)).toEqual([other!.id]);
    const before = embedder.calls;
    expect(await port.vectorNeighbors(orgId, "u-owner", PARAPHRASE, [], 8)).toEqual([]);
    expect(embedder.calls).toBe(before);
  });
});

describe("S9 ⑤ 降级：向量不可用时退回字面 + 图，并如实说", () => {
  it("嵌入服务挂了 ⇒ 这一轮向量通道记为故障，字面 / 图的结果照常，材料里带「相似查询暂不可用」", async () => {
    const down = new LoopbackEmbedding();
    down.fail = true;
    const r = await recall(new PgKnowledgeRecall(db, down), fx.B, "客户 A 有什么要求？");
    expect(r.degraded).toEqual(["vector"]);
    expect(r.items[0]).toMatchObject({ claim: { id: fx.personalClaimId }, channels: ["fts", "graph"] });
    expect(buildKnowledgeContextMessage(r)).toContain(VECTOR_RECALL_DEGRADED_NOTICE);
  });

  it("配置的模型没登记 ⇒ 按故障降级（不当成「没有相似的」静默略过）", async () => {
    const r = await recall(new PgKnowledgeRecall(db, new LoopbackEmbedding("kg-s9-unregistered", "v1")), fx.B, PARAPHRASE);
    expect(r.degraded).toEqual(["vector"]);
    expect(r.items.map((i) => i.claim.statement)).not.toContain(DEMAND);
  });

  it("worker 遇到服务不可用：本轮停下、不计失败次数，outbox 行保留；恢复后补齐", async () => {
    await asOwner((x) => x.query("UPDATE claims SET statement = '项目预算是 90 万' WHERE org_id = $1 AND statement = '项目预算是 80 万'", [ORG]));
    const down = new LoopbackEmbedding();
    down.fail = true;
    const r = await runEmbeddingTick({ queue: scoped(queue), embeddings: down, logger: silentLogger });
    expect(r).toMatchObject({ providerUnavailable: true, written: 0, failed: 0 });
    const [row] = await asOwner(async (x) => (await x.query<{ attempts: number }>(
      `SELECT q.attempts FROM kg_embedding_outbox q JOIN claims c ON c.id = q.target_id
        WHERE q.org_id = $1 AND c.statement = '项目预算是 90 万'`, [ORG])).rows);
    expect(row).toEqual({ attempts: 0 });
    await drain();
    const [v] = await asOwner(async (x) => (await x.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM object_embeddings e JOIN claims c ON c.id = e.target_id
        WHERE e.org_id = $1 AND c.statement = '项目预算是 90 万' AND e.model = $2`, [ORG, embedder.model])).rows);
    expect(v).toEqual({ n: "1" });
  });

  it("维度不符的向量被库拒 ⇒ 记一次失败（固定错误码，不含正文），不影响别的目标", async () => {
    const [c] = await asOwner(async (x) => (await x.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND statement = '项目预算是 90 万'", [ORG])).rows);
    await asOwner((x) => x.query("UPDATE claims SET statement = '项目预算是 100 万' WHERE id = $1", [c!.id]));
    const wrong = new LoopbackEmbedding();
    wrong.embed = async () => [0.1, 0.2, 0.3];
    const r = await runEmbeddingTick({ queue: scoped(queue), embeddings: wrong, logger: silentLogger });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [row] = await asOwner(async (x) => (await x.query<{ attempts: number; last_error: string }>(
      "SELECT attempts, last_error FROM kg_embedding_outbox WHERE org_id = $1 AND target_id = $2", [ORG, c!.id])).rows);
    expect(row).toEqual({ attempts: 1, last_error: "kg_embedding_write_rejected" });
    await drain();
    expect(await outbox("claim", c!.id)).toBe(0);
  });
});
