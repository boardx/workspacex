/**
 * Phase 18 F08 —— 会话知识的混合召回：图路（AGE）+ 字面（fts），图路只加分（uc-18-2 R3 / R7-2 / V3）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { lexicalTokens } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { seedRecallOrg } from "../knowledge-graph/kg-recall-fixtures";

const ORG = "org-kg-f08-hybrid";
const T1 = "thr-kg-f08-h1";
const T2 = "thr-kg-f08-h2";
let db: PgDatabase;
let port: PgKnowledgeRecall;
const noLog = () => undefined;
const recall = (query: string, p: KnowledgeRecallPort = port, threadId = T1) =>
  recallThreadKnowledge(p, { orgId: toOrgId(ORG), userId: "u-owner", threadId, query }, noLog);

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  // T2 挂在项目下：它不在 u-owner 的个人空间里，「别的会话不会漏进来」才有意义（F15 起本人其他个人对话也会被召回）。
  await seedRecallOrg(db, ORG, [T1, T2], "u-owner", { projectThreads: [T2] });
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F08: 图路 + 字面混合", () => {
  it("「v2 是谁定的」：问题里的 v2 被解析成图种子；决定那条同时被字面与图路命中，排第一，带走过的边", async () => {
    const r = await recall("v2 是谁定的？");
    expect(r.graphSeeds).toHaveLength(1);
    const top = r.items[0]!;
    expect(top.claim.statement).toBe("张三决定下周一上线 v2");
    expect(top.channels).toEqual(["fts", "graph"]);
    expect(top.graphPath).toEqual([expect.objectContaining({ relation: "about" })]);
    expect(top.graphPath![0]!.src).toMatch(/^object:/);
  });

  it("三跳：问「老张」（别名）⇒ 张三拍板的决定（1 跳），以及同一产品相关的风险（经 v2 的 3 跳）", async () => {
    const r = await recall("老张最近在忙什么");
    const byStatement = new Map(r.items.map((i) => [i.claim.statement, i]));
    expect(byStatement.get("张三决定下周一上线 v2")?.graphPath).toHaveLength(1);
    const risk = byStatement.get("测试环境不稳定会拖慢 v2");
    expect(risk?.channels).toEqual(["graph"]);
    expect(risk?.graphPath).toHaveLength(3);
    expect(r.items.some((i) => i.claim.statement.includes("预算"))).toBe(false);  // 与问题无关，也不在图邻域
  });

  it("图路只加分：只有图路命中的排在字面命中之后", async () => {
    const r = await recall("v2 的测试环境");
    const channels = r.items.map((i) => i.channels.join("+"));
    const firstGraphOnly = channels.indexOf("graph");
    const lastLexical = Math.max(...channels.map((c, i) => (c.includes("fts") ? i : -1)));
    if (firstGraphOnly !== -1) expect(firstGraphOnly).toBeGreaterThan(lastLexical);
  });

  it("关掉图路，结果集仍然合理（字面照样找到那条决定），计划里图路标为不可用", async () => {
    const noGraph: KnowledgeRecallPort = { recordTurn: async () => undefined, candidates: (...a) => port.candidates(...a), graphNeighbors: async () => { throw new Error("KG_GRAPH_UNAVAILABLE"); } };
    const r = await recall("v2 是谁定的？", noGraph);
    expect(r.items[0]?.claim.statement).toBe("张三决定下周一上线 v2");
    expect(r.items.every((i) => !i.channels.includes("graph"))).toBe(true);
    expect(r.plan.find((p) => p.channel === "graph")).toEqual({ channel: "graph", weight: 0.5, hitCount: 0, available: false });
  });

  it("图里是全 org 的 id：别的会话的结论即使出现在图邻域里，也不会被召回（回候选集求交）", async () => {
    const other = await port.candidates(toOrgId(ORG), "u-owner", T2);
    const leaky: KnowledgeRecallPort = {
      recordTurn: async () => undefined,
      candidates: (...a) => port.candidates(...a),
      graphNeighbors: async (o, seeds) => [
        ...(await port.graphNeighbors(o, seeds)),
        ...other.claims.map((c) => ({ claimId: c.id, path: [{ src: seeds[0]!, relation: "about", dst: `claim:${c.id}` }] })),
      ],
    };
    const r = await recall("v2 是谁定的？", leaky);
    const otherIds = new Set(other.claims.map((c) => c.id));
    expect(r.items.some((i) => otherIds.has(i.claim.id))).toBe(false);
  });

  it("中文按二字组切词（默认解析器不切中文）", () => {
    expect([...lexicalTokens("谁定的 v2")].sort()).toEqual(["v2", "定的", "谁定"]);
  });
});
