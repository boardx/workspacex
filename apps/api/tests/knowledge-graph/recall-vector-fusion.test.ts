/**
 * S9（#4366）—— 图 + 向量混合召回的融合与降级（纯函数 + 应用层，无库）。
 *   - 换了说法（字面零重合）的问题，向量通道仍把那条记忆召回来；与字面 / 图同时命中的标「lead」；
 *   - 向量通道有界：只认候选集、相似度下限、top-k；
 *   - 没配置（省略）≠ 故障（null）：前者不提醒、排序与 S9 之前逐条相同；后者降级为字面 + 图，并如实告诉用户；
 *   - 应用层：向量通道超时 / 抛错都降级、不拖住这一轮，而且与图路并行。
 */
import { describe, expect, it } from "vitest";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { KG_VECTOR_RECALL_TIMEOUT_MS, recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import {
  buildKnowledgeContextMessage, fuseRecall, recallDegraded, RECALL_DEGRADED_NOTICE, VECTOR_RECALL_DEGRADED_NOTICE, VECTOR_RECALL_TOP_K,
  type GraphHit, type RecallClaim, type RecallObject, type VectorHit,
} from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";

const claim = (id: string, statement: string, over: Partial<RecallClaim> = {}): RecallClaim =>
  ({ id, statement, kind: "fact", triState: "pending", saidAt: null, scope: "chat_session", ...over });
const zhang: RecallObject = { id: "z", name: "张三", aliases: ["老张"] };
const hop = (claimId: string): GraphHit => ({ claimId, path: [{ src: "object:z", relation: "decided_by", dst: `claim:${claimId}` }] });
const LAUNCH = claim("launch", "张三决定下周一上线 v2", { kind: "decision" });
const BUDGET = claim("budget", "季度预算已经批下来了");
const RISK = claim("risk", "测试环境不稳定会拖慢 v2", { kind: "risk" });
// 与 LAUNCH 字面零重合（二字组一个都不共享），说的却是同一件事。
const PARAPHRASE = "新版本什么时候发布";

describe("S9: 向量通道召回换了说法的问题", () => {
  it("字面零重合的换说法，没有向量通道就召不回；有向量通道就召回、通道记为 vector", () => {
    // 不含「决定」字样：这条测的是向量通道本身，不让 #4181 的决定类强制召回把它带进来。
    const base = { query: PARAPHRASE, claims: [BUDGET, RISK, claim("launch", "v2 下周一上线")], objects: [zhang], graph: [], limit: 8 };
    expect(fuseRecall(base).items.map((i) => i.claim.id)).toEqual([]);
    const r = fuseRecall({ ...base, vector: [{ claimId: "launch", similarity: 0.82 }, { claimId: "budget", similarity: 0.1 }] });
    expect(r.items.map((i) => [i.claim.id, i.channels])).toEqual([["launch", ["vector"]]]);
    expect(r.plan.find((p) => p.channel === "vector")).toEqual({ channel: "vector", weight: 1, hitCount: 1, available: true });
    expect(r.degraded).toEqual([]);
    expect(buildKnowledgeContextMessage(r)).toContain("v2 下周一上线");
  });

  it("字面与向量同时命中 ⇒ channels 两路都记、理由带 lead；图路命中照旧只加分", () => {
    const r = fuseRecall({
      query: "张三什么时候上线 v2", claims: [LAUNCH, RISK], objects: [zhang], graph: [hop("launch")],
      vector: [{ claimId: "launch", similarity: 0.9 }], limit: 8,
    });
    const top = r.items[0]!;
    expect(top.claim.id).toBe("launch");
    expect(top.channels).toEqual(["fts", "graph", "vector"]);
    expect(top.retrievalReasons).toContain("lead");
    expect(top.graphPath).not.toBeNull();
  });

  it("直接命中之间按贴切度：高相似度的换说法排在勉强过线的字面命中前面；只有图路的仍排在所有直接命中之后", () => {
    const r = fuseRecall({
      // 「v2」一个词元：两条都勉强过字面线（1/4）；LAUNCH 另有 0.8 的相似度。
      query: "v2 何时发布", claims: [RISK, LAUNCH, claim("g", "张三拍板", { kind: "decision" })],
      objects: [zhang], graph: [hop("g")], vector: [{ claimId: "launch", similarity: 0.8 }], limit: 8,
    });
    expect(r.items.map((i) => i.claim.id)).toEqual(["launch", "risk", "g"]);
    expect(r.items[2]!.channels).toEqual(["graph"]);
  });
});

describe("S9: 向量通道有界", () => {
  it("候选集之外的 id、相似度低于下限的、非有限数都不算命中", () => {
    const r = fuseRecall({
      query: PARAPHRASE, claims: [LAUNCH, BUDGET], objects: [], graph: [],
      vector: [{ claimId: "someone-elses", similarity: 0.99 }, { claimId: "budget", similarity: 0.2 }, { claimId: "launch", similarity: Number.NaN }],
      limit: 8,
    });
    expect(r.items.filter((i) => i.channels.includes("vector"))).toEqual([]);
    expect(r.plan.find((p) => p.channel === "vector")?.hitCount).toBe(0);
  });

  it("最多 top-k 条经向量通道进来", () => {
    const many = Array.from({ length: VECTOR_RECALL_TOP_K + 5 }, (_, i) => claim(`c${String(i).padStart(2, "0")}`, `甲乙丙丁第${i}条`));
    const hits: VectorHit[] = many.map((c, i) => ({ claimId: c.id, similarity: 0.9 - i * 0.01 }));
    const r = fuseRecall({ query: PARAPHRASE, claims: many, objects: [], graph: [], vector: hits, limit: 50 });
    expect(r.items.filter((i) => i.channels.includes("vector")).map((i) => i.claim.id)).toEqual(many.slice(0, VECTOR_RECALL_TOP_K).map((c) => c.id));
  });
});

describe("S9: 没配置 ≠ 故障", () => {
  const input = { query: "谁负责 v2 上线", claims: [claim("lex", "v2 上线由测试组负责"), claim("g", "张三拍板", { kind: "decision" as const, triState: "confirmed" as const })], objects: [zhang], graph: [hop("g")], limit: 8 };

  it("没配置（省略）：排序与 S9 之前相同，不可用但不算降级，材料里不提醒", () => {
    const r = fuseRecall(input);
    expect(r.items.map((i) => i.claim.id)).toEqual(["lex", "g"]);
    expect(r.plan.find((p) => p.channel === "vector")).toEqual({ channel: "vector", weight: 0, hitCount: 0, available: false });
    expect(r.degraded).toEqual([]);
    expect(recallDegraded(r)).toBe(false);
    expect(buildKnowledgeContextMessage(r)).not.toContain(VECTOR_RECALL_DEGRADED_NOTICE);
  });

  it("配置了但失败（null）：降级为字面 + 图（结果不变），记入 degraded，材料里带「相似查询暂不可用」", () => {
    const r = fuseRecall({ ...input, vector: null });
    expect(r.items.map((i) => i.claim.id)).toEqual(["lex", "g"]);
    expect(r.plan.find((p) => p.channel === "vector")).toEqual({ channel: "vector", weight: 0, hitCount: 0, available: false });
    expect(r.degraded).toEqual(["vector"]);
    expect(recallDegraded(r)).toBe(true);
    const m = buildKnowledgeContextMessage(r)!;
    expect(m).toContain(VECTOR_RECALL_DEGRADED_NOTICE);
    expect(m).not.toContain(RECALL_DEGRADED_NOTICE);
  });

  it("图与向量都坏了、一条也没召回 ⇒ 两句说明都在，不塞空壳", () => {
    const r = fuseRecall({ query: "老张最近在忙什么", claims: [claim("c1", "张三上周五请假了")], objects: [zhang], graph: null, vector: null, limit: 8 });
    expect(r.items).toEqual([]);
    expect(buildKnowledgeContextMessage(r)).toBe(`【记忆】（${RECALL_DEGRADED_NOTICE}）\n【记忆】（${VECTOR_RECALL_DEGRADED_NOTICE}）`);
  });
});

describe("S9: 应用层——向量通道并行、有时限、失败降级", () => {
  const ORG = toOrgId("org-s9-unit");
  const logs: { message: string; detail: Record<string, unknown> }[] = [];
  const log = (message: string, detail: Record<string, unknown>) => { logs.push({ message, detail }); };
  const base = (over: Partial<KnowledgeRecallPort>): KnowledgeRecallPort => ({
    candidates: async () => ({ claims: [LAUNCH, BUDGET], objects: [zhang] }),
    graphNeighbors: async () => [hop("launch")],
    recordTurn: async () => undefined,
    ...over,
  });
  const run = (port: KnowledgeRecallPort, query = PARAPHRASE) =>
    recallThreadKnowledge(port, { orgId: ORG, userId: "u", threadId: "t", query }, log);

  it("端口没有向量方法 ⇒ 未启用；返回 null ⇒ 未启用（都不算降级）", async () => {
    for (const port of [base({}), base({ vectorNeighbors: async () => null })]) {
      const r = await run(port);
      expect(r.plan.find((p) => p.channel === "vector")?.available).toBe(false);
      expect(r.degraded).toEqual([]);
    }
  });

  it("只把候选集的 id 交给向量通道，命中进入融合", async () => {
    let seen: readonly string[] = [];
    const r = await run(base({ vectorNeighbors: async (_o, _u, _q, ids) => { seen = await ids; return [{ claimId: "launch", similarity: 0.8 }]; } }));
    expect(seen).toEqual(["launch", "budget"]);
    expect(r.items.find((i) => i.claim.id === "launch")?.channels).toContain("vector");
  });

  it("嵌入服务报错 ⇒ 降级，日志只有固定形状的原因码、不含问题原文", async () => {
    logs.length = 0;
    const r = await run(base({ vectorNeighbors: async () => { throw new Error("embedding_unavailable"); } }));
    expect(r.degraded).toEqual(["vector"]);
    expect(logs).toEqual([{ message: "knowledge recall vector channel unavailable, continuing with text and graph only", detail: { threadId: "t", code: "embedding_unavailable" } }]);
    expect(JSON.stringify(logs)).not.toContain(PARAPHRASE);
  });

  it("库 / 驱动的原始报错不原样进日志（可能带数据），归为固定码", async () => {
    logs.length = 0;
    await run(base({ vectorNeighbors: async () => { throw new Error(`duplicate key value violates … (${PARAPHRASE})`); } }));
    expect(logs[0]!.detail).toEqual({ threadId: "t", code: "kg_vector_recall_failed" });
  });

  it("问题的嵌入与读候选集并行：候选集还没读完，向量通道就已经开始；时限从候选集读完算起", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const port = base({
      candidates: async () => { order.push("candidates:start"); await gate; order.push("candidates:done"); return { claims: [LAUNCH, BUDGET], objects: [zhang] }; },
      vectorNeighbors: async (_o, _u, _q, ids) => { order.push("vector:start"); await ids; return [{ claimId: "launch", similarity: 0.8 }]; },
    });
    const p = run(port);
    await new Promise((r) => setTimeout(r, KG_VECTOR_RECALL_TIMEOUT_MS + 100)); // 候选集读得比向量时限还久
    expect(order).toEqual(["candidates:start", "vector:start"]);
    release();
    const r = await p;
    expect(r.degraded).toEqual([]);
    expect(r.items.find((i) => i.claim.id === "launch")?.channels).toContain("vector");
  });

  it(`向量通道超过 ${KG_VECTOR_RECALL_TIMEOUT_MS}ms ⇒ 按超时降级，这一轮不等它；与图路并行（总耗时≈较慢的一路）`, async () => {
    logs.length = 0;
    const slow = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const started = Date.now();
    const r = await run(base({
      graphNeighbors: async () => { await slow(250); return [hop("launch")]; },
      vectorNeighbors: async () => { await slow(5_000); return [{ claimId: "launch", similarity: 0.9 }]; },
    }), "张三 v2");
    const took = Date.now() - started;
    expect(r.degraded).toEqual(["vector"]);
    expect(logs[0]!.detail).toEqual({ threadId: "t", code: "kg_vector_recall_timeout" });
    expect(took).toBeGreaterThanOrEqual(KG_VECTOR_RECALL_TIMEOUT_MS - 20);
    expect(took).toBeLessThan(KG_VECTOR_RECALL_TIMEOUT_MS + 250);
    // 图路照常：张三那条经图路召回
    expect(r.items.find((i) => i.claim.id === "launch")?.channels).toContain("graph");
  });
});
