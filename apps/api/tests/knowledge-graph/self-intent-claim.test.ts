/**
 * issue #4343（人类决定 2026-09-27）—— 目标 / 偏好两类结论的纯函数部分：
 *   - 契约与抽取 schema 认得 goal / preference（解析不再把它们当枚举外丢掉）；
 *   - 抽取 prompt 问到了本人目标 / 偏好，也写明了排除项；流水线版本已升；
 *   - `selfIntentLike` 的保守句式门（第一人称单数、非问句、非假设）；
 *   - 召回：本会话 / 本人个人空间的目标 / 偏好每轮强制带上，名额另计、不挤掉决定；跨会话的不强制。
 */
import { describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { DECISION_RECALL_LIMIT } from "../../src/domain/knowledge-graph/decision-claim";
import { buildExtractionBatch, KG_EXTRACTION_PIPELINE_VERSION, parseExtraction } from "../../src/domain/knowledge-graph/extraction";
import { fuseRecall, type RecallClaim } from "../../src/domain/knowledge-graph/recall";
import { SELF_INTENT_RECALL_LIMIT, selfIntentLike } from "../../src/domain/knowledge-graph/self-intent-claim";
import {
  KG_EXTRACTION_RESPONSE_SCHEMA, KG_EXTRACTION_SYSTEM_PROMPT,
} from "../../src/infrastructure/knowledge-graph/model-knowledge-extractor";

const GOAL = "我的目标是探索未来教育";

describe("#4343 契约 / 抽取 schema", () => {
  it("KgClaimKind 认 goal 与 preference，本人意向类恰是这两个", () => {
    expect(KG.KgClaimKind.safeParse("goal").success).toBe(true);
    expect(KG.KgClaimKind.safeParse("preference").success).toBe(true);
    expect(KG.KgClaimKind.safeParse("wish").success).toBe(false);
    expect([...KG.KG_SELF_INTENT_CLAIM_KINDS]).toEqual(["goal", "preference"]);
    expect(KG.isSelfIntentClaimKind("goal")).toBe(true);
    expect(KG.isSelfIntentClaimKind("decision")).toBe(false);
    expect(KG.isSelfIntentClaimKind(null)).toBe(false);
  });

  it("读模型形状带 kind：反馈条与引用 chip 都要标类型", () => {
    const ex = { claims: [{ claimId: "c", statement: GOAL, kind: "goal", personalCopyClaimId: null }], status: "written" as const };
    expect(KG.KgMessageExtraction.safeParse(ex).success).toBe(true);
    expect(KG.KgMessageExtraction.safeParse({ ...ex, claims: [{ ...ex.claims[0], kind: undefined }] }).success).toBe(false);
    const rec = {
      claimId: "c", statement: GOAL, kind: "goal", triState: "pending", scope: "personal", saidAt: null,
      channels: ["claim"], retrievalReasons: ["recall"], score: 0, graphPath: null,
    };
    expect(KG.KgRecalledMemory.safeParse(rec).success).toBe(true);
  });

  it("约束解码的 schema 枚举来自契约，含 goal / preference", () => {
    const kinds = KG_EXTRACTION_RESPONSE_SCHEMA.schema.properties.claims.items.properties.kind.enum;
    expect(kinds).toEqual(expect.arrayContaining(["goal", "preference"]));
  });

  it("prompt 问本人目标 / 偏好，写明排除项；流水线版本已升（同一消息按新版本重跑）", () => {
    for (const s of ["goal", "preference", "我的目标是", "我想", "我希望", "我更喜欢", "第一人称", "about 可以为空", "别人的目标", "假设", "提问"]) {
      expect(KG_EXTRACTION_SYSTEM_PROMPT).toContain(s);
    }
    expect(KG_EXTRACTION_PIPELINE_VERSION).not.toBe("kg-extract@1");
  });

  it("模型回 goal ⇒ 解析保留、批次里是 goal 结论、about 为空也照写（没有实体也能记下）", () => {
    const parsed = parseExtraction({
      entities: [], claims: [{ statement: GOAL, kind: "goal", confidence: 0.9, about: [], decidedBy: null, quote: GOAL }],
    });
    expect(parsed.claims.map((c) => c.kind)).toEqual(["goal"]);
    let n = 0;
    const batch = buildExtractionBatch({
      threadId: "t", messageId: "m", messageBody: GOAL, result: parsed, known: [], newId: (p) => `${p}-${(n += 1)}`,
    });
    expect(batch?.claims).toEqual([expect.objectContaining({ claimKind: "goal", statement: GOAL, status: "proposed" })]);
    expect(batch?.edges).toEqual([]);
    expect(batch?.pipelineVersion).toBe(KG_EXTRACTION_PIPELINE_VERSION);
  });
});

describe("#4343 selfIntentLike：类型 + 保守句式门", () => {
  it.each([
    ["goal", GOAL],
    ["goal", "我想今年把英语考到雅思 7 分"],
    ["goal", "我希望团队周报每周五发出"],
    ["preference", "我更喜欢简洁的回答"],
    ["preference", "我倾向于先看数据再下结论"],
  ] as const)("%s「%s」⇒ true", (kind, statement) => {
    expect(selfIntentLike(kind, statement)).toBe(true);
  });

  it.each([
    ["fact", GOAL, "类型不是 goal / preference"],
    ["decision", "我更喜欢简洁的回答", "类型不是 goal / preference"],
    ["goal", "张三的目标是探索未来教育", "别人的目标"],
    ["goal", "我们的目标是年底上线", "集体口吻"],
    ["goal", "我的目标是什么？", "问句"],
    ["goal", "我的目标是不是太大了吗", "问句尾"],
    ["goal", "我想如果有机会就去读博", "假设"],
    ["preference", "我喜欢", "过短"],
    ["goal", "我想让你帮我写一封邮件", "对助手的请求（#4392 评审）"],
    ["goal", "我想问一下明天的会议", "对助手的提问（#4392 评审）"],
    ["preference", "我希望你用英文回答", "对助手的请求（#4392 评审）"],
    ["goal", "我的目标函数是最小化交叉熵损失", "术语，不是人的目标（#4392 评审）"],
  ] as const)("%s「%s」⇒ false（%s）", (kind, statement, _why) => {
    expect(selfIntentLike(kind, statement)).toBe(false);
  });
});

const claim = (id: string, statement: string, over: Partial<RecallClaim> = {}): RecallClaim =>
  ({ id, statement, kind: "fact", triState: "pending", saidAt: null, scope: "chat_session", ...over });

describe("#4343 召回：目标 / 偏好每轮强制带上，名额另计", () => {
  it("无关问题（「帮我规划一下」）也带上个人空间里的目标，走 claim 通道", () => {
    const r = fuseRecall({
      query: "帮我规划一下", claims: [claim("g", GOAL, { kind: "goal", scope: "personal" })], objects: [], graph: [], limit: 8,
    });
    expect(r.items.map((i) => [i.claim.id, i.channels])).toEqual([["g", ["claim"]]]);
    expect(r.plan.find((p) => p.channel === "claim")?.hitCount).toBe(1);
  });

  it("同样的句子若类型是 fact ⇒ 不强制（先看类型）", () => {
    const r = fuseRecall({ query: "帮我规划一下", claims: [claim("g", GOAL, { kind: "fact" })], objects: [], graph: [], limit: 8 });
    expect(r.items).toEqual([]);
  });

  it("跨会话（F15，originThreadId 有值）的不强制——同决定类的来源边界", () => {
    const r = fuseRecall({
      query: "帮我规划一下", claims: [claim("g", GOAL, { kind: "goal", scope: "personal", originThreadId: "t-other" })],
      objects: [], graph: [], limit: 8,
    });
    expect(r.items).toEqual([]);
  });

  it("目标超过上限按最新取；不挤掉决定类的名额（两类各自有界）", () => {
    const decisions = Array.from({ length: DECISION_RECALL_LIMIT }, (_, i) =>
      claim(`d${i}`, `我决定聚焦第 ${i} 个市场`, { kind: "decision", saidAt: `2026-09-2${i}T00:00:00Z` }));
    const goals = Array.from({ length: SELF_INTENT_RECALL_LIMIT + 2 }, (_, i) =>
      claim(`g${i}`, `我的目标是完成第 ${i} 件事`, { kind: "goal", scope: "personal", saidAt: `2026-09-1${i}T00:00:00Z` }));
    const r = fuseRecall({ query: "帮我规划一下", claims: [...goals, ...decisions], objects: [], graph: [], limit: 8 });
    const ids = r.items.map((i) => i.claim.id);
    expect(ids.filter((id) => id.startsWith("d")).sort()).toEqual(decisions.map((d) => d.id).sort());
    // 最新的 SELF_INTENT_RECALL_LIMIT 条（saidAt 倒序）
    expect(ids.filter((id) => id.startsWith("g"))).toEqual(goals.slice(-SELF_INTENT_RECALL_LIMIT).reverse().map((g) => g.id));
    expect(ids).toHaveLength(DECISION_RECALL_LIMIT + SELF_INTENT_RECALL_LIMIT);
  });
});
