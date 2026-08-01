/**
 * F94 —— 引述抽取后生成候选洞察：必须带可追溯来源，来源不足不得伪造结论
 * (`uc-6-5` R3 step2-3, AC1，契约 `generateCandidateInsights`/`confirmInsight` 的
 * `INSIGHT_NO_EVIDENCE`)。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import {
  buildCandidateInsight,
  checkConfirmable,
  type QuoteForCandidate,
} from "../../src/domain/interview/candidate-insight";

describe("F94 · AC1 · 候选洞察必须挂引述来源，空来源不产出候选", () => {
  it("给定至少一条引述 ⇒ 生成候选，且 evidenceQuoteIds 可追溯回这些引述", () => {
    const quotes: QuoteForCandidate[] = [{ quoteId: "q1", sourceKind: "human" }];
    const result = buildCandidateInsight({ text: "责任归属无人承担", quotes }, { insightId: "ins-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.evidenceQuoteIds).toEqual(["q1"]);
      expect(result.candidate.strong).toBe(false);
      expect(result.candidate.pinnedSourceSnapshotId).toBeNull();
    }
  });

  it("空引述列表 ⇒ INSIGHT_NO_EVIDENCE，不产出任何候选（不得伪造结论）", () => {
    const result = buildCandidateInsight({ text: "无来源的结论", quotes: [] }, { insightId: "ins-2" });
    expect(result).toEqual({ ok: false, reason: "INSIGHT_NO_EVIDENCE" });
  });

  it("契约 generateCandidateInsights.err 收录 INSIGHT_NO_EVIDENCE", () => {
    expect(interview.operations.generateCandidateInsights.err).toContain("INSIGHT_NO_EVIDENCE");
  });

  it("生成结果通过契约 Insight schema 校验", () => {
    const result = buildCandidateInsight(
      { text: "本地案例决定信任", quotes: [{ quoteId: "q9", sourceKind: "human" }] },
      { insightId: "ins-3" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(() => interview.Insight.parse(result.candidate)).not.toThrow();
  });
});

describe("F94 · sourceKind 传播（C_ITV_6 的保守默认）：任一虚拟来源即整条候选标 virtual", () => {
  it("全部引述来自真人 ⇒ candidate.sourceKind === 'human'", () => {
    const quotes: QuoteForCandidate[] = [
      { quoteId: "q1", sourceKind: "human" },
      { quoteId: "q2", sourceKind: "human" },
    ];
    const result = buildCandidateInsight({ text: "t", quotes }, { insightId: "ins-4" });
    expect(result.ok && result.candidate.sourceKind).toBe("human");
  });

  it("混入一条虚拟来源 ⇒ candidate.sourceKind === 'virtual'（保守默认，防止虚拟证据被稀释成『真人洞察』）", () => {
    const quotes: QuoteForCandidate[] = [
      { quoteId: "q1", sourceKind: "human" },
      { quoteId: "q2", sourceKind: "virtual" },
    ];
    const result = buildCandidateInsight({ text: "t", quotes }, { insightId: "ins-5" });
    expect(result.ok && result.candidate.sourceKind).toBe("virtual");
  });
});

describe("F94 · AC1 · confirmInsight 复用同一道『缺来源不可确认』门", () => {
  it("evidenceQuoteIds 非空 ⇒ 可确认", () => {
    expect(checkConfirmable({ evidenceQuoteIds: ["q1"] })).toEqual({ ok: true });
  });

  it("evidenceQuoteIds 为空 ⇒ INSIGHT_NO_EVIDENCE，即便走到了 confirm 这一步（例如客户端编辑态清空了证据）", () => {
    expect(checkConfirmable({ evidenceQuoteIds: [] })).toEqual({ ok: false, reason: "INSIGHT_NO_EVIDENCE" });
  });

  it("契约 confirmInsight.err 同样收录 INSIGHT_NO_EVIDENCE（生成与确认共享同一个码，不是两套口径）", () => {
    expect(interview.operations.confirmInsight.err).toContain("INSIGHT_NO_EVIDENCE");
  });
});
