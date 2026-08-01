/**
 * F145 —— N-3 / R7.3：低置信度必须标出而不是丢弃；R7.5：样本不足产出争议项而不是弱结论
 * （`research` 束 domain.md N-3，`uc-24-2` R3.4 / R7.3 / R7.5 / R12.2 / R12.3）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 断言打在性质上，不是数量上（纪律第 9 条 / coding-standards E-4）
 *
 * R12.2 逐字：「造一条置信度 0.3 的来源，断言它**出现在**段 ③（性质断言：低置信条目
 * 不被过滤），而不是断言来源总数等于某个固定值」。本文件因此**不**写
 * `toHaveLength(14)` 这类断言——那种断言在「删一条加一条」时会全绿，而真正该被
 * 捕捉的回归（"渲染层悄悄加了一个 confidence >= 0.5 的过滤条件"）反而测不出来。
 */
import { describe, expect, it } from "vitest";
import {
  assembleResearchResult,
  isSampleTooSmall,
  type ResearchClaimInput,
  type EvidenceT,
} from "../../src/domain/research/result-assembly";

function evidence(overrides: Partial<EvidenceT> & Pick<EvidenceT, "id" | "sourceRef">): EvidenceT {
  return {
    claim: "占位陈述",
    sourceKind: "媒体",
    confidence: null,
    disposition: "已引用",
    ...overrides,
  };
}

describe("F145 · R7.3 低置信来源必须出现在段③，不被过滤", () => {
  it("一条 confidence=0.3 的来源，即便挂在一个有效结论下，仍然出现在 externalSources 里", () => {
    const lowConfidenceSource = evidence({
      id: "src-low-1",
      sourceRef: "PV-Magazine：巴伐利亚积压报道",
      sourceKind: "媒体",
      confidence: 0.3,
    });
    const claims: ResearchClaimInput[] = [
      {
        claim: "德国并网审批全国中位 11 个月",
        evidence: [
          evidence({ id: "src-1", sourceRef: "Bundesnetzagentur 年报 2025", sourceKind: "官方", confidence: 0.9 }),
          evidence({ id: "src-2", sourceRef: "BVES 会员调查 2025", sourceKind: "行业", confidence: 0.7 }),
          lowConfidenceSource,
        ],
      },
    ];

    const result = assembleResearchResult({ claims, conclusionText: "以监管年报为准，按 11 个月中位数规划。" });

    const found = result.externalSources.find((e) => e.id === "src-low-1");
    expect(found, "0.3 置信度的来源不见了——它被过滤掉了").not.toBeUndefined();
    expect(found?.confidence).toBe(0.3);
    // 反空转：这条断言必须真的在测"没被过滤"，不是凑巧数组非空。
    expect(result.externalSources.some((e) => e.confidence !== null && e.confidence < 0.5)).toBe(true);
  });

  it("多条低置信来源（含 confidence=null 的『—』行）全部原样列出，一条都不少", () => {
    const claims: ResearchClaimInput[] = [
      {
        claim: "州际差异主要来自电网公司排队",
        evidence: [
          evidence({ id: "e1", sourceRef: "a", confidence: 0.9 }),
          evidence({ id: "e2", sourceRef: "b", confidence: 0.7 }),
          evidence({ id: "e3", sourceRef: "c", confidence: 0.3 }),
          evidence({ id: "e4", sourceRef: "d", confidence: 0.25 }),
          // N-8：缺失渲染为 null（—），不是被当成"没有这条证据"而丢弃
          evidence({ id: "e5", sourceRef: "e", confidence: null }),
        ],
      },
    ];
    const result = assembleResearchResult({ claims, conclusionText: "结论文案" });
    const ids = result.externalSources.map((e) => e.id);
    expect(ids).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });
});

describe("F145 · R7.5 样本不足（<2 条独立来源）落进争议段，不产出弱结论", () => {
  it("只有 1 条独立来源的 claim：落进 disputed，且不出现在 keyFindings", () => {
    const singleSourceClaim = "只找到 1 例判例说明交割后资质要重新备案，样本太少";
    const claims: ResearchClaimInput[] = [
      {
        claim: singleSourceClaim,
        evidence: [evidence({ id: "e-single", sourceRef: "交割后资质重新备案判例（单例）", confidence: 0.3 })],
      },
      {
        claim: "德国并网审批全国中位 11 个月",
        evidence: [
          evidence({ id: "e-a", sourceRef: "官方年报", confidence: 0.9 }),
          evidence({ id: "e-b", sourceRef: "行业调查", confidence: 0.7 }),
        ],
      },
    ];

    const result = assembleResearchResult({ claims, conclusionText: "结论文案" });

    expect(result.disputed).toContain(singleSourceClaim);
    expect(result.keyFindings).not.toContain(singleSourceClaim);
    // 双来源的 claim 走的是另一条路：进 keyFindings，不进 disputed。
    expect(result.keyFindings).toContain("德国并网审批全国中位 11 个月");
    expect(result.disputed).not.toContain("德国并网审批全国中位 11 个月");
  });

  it("样本不足的证据依然完整出现在段③——N-3 与 R7.5 同时成立，互不冲突", () => {
    const claims: ResearchClaimInput[] = [
      {
        claim: "只找到 1 例判例",
        evidence: [evidence({ id: "e-single", sourceRef: "判例检索（单例）", confidence: 0.3 })],
      },
    ];
    const result = assembleResearchResult({ claims, conclusionText: null });
    expect(result.disputed).toContain("只找到 1 例判例");
    expect(result.keyFindings).toEqual([]);
    // ⚠ 这是本文件最容易做错的一条：争议项的证据也不能从段③消失。
    expect(result.externalSources.map((e) => e.id)).toEqual(["e-single"]);
  });

  it("判据函数本身：独立来源去重按 sourceRef，同一来源重复引用两次仍算样本不足", () => {
    expect(isSampleTooSmall([evidence({ id: "a", sourceRef: "same" }), evidence({ id: "b", sourceRef: "same" })])).toBe(true);
    expect(isSampleTooSmall([evidence({ id: "a", sourceRef: "x" }), evidence({ id: "b", sourceRef: "y" })])).toBe(false);
    expect(isSampleTooSmall([])).toBe(true);
  });
});

describe("F145 · E2 零来源：段①为空，段④是数据需求说明而不是结论", () => {
  it("claims 为空 ⇒ isDataRequest=true，conclusion=null，即便调用方传了结论文案也被忽略", () => {
    const result = assembleResearchResult({ claims: [], conclusionText: "不应该出现的结论" });
    expect(result.keyFindings).toEqual([]);
    expect(result.disputed).toEqual([]);
    expect(result.externalSources).toEqual([]);
    expect(result.conclusion).toBeNull();
    expect(result.isDataRequest).toBe(true);
  });
});
