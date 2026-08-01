/**
 * F147 —— 结论入洞察库的三道门槛（N-1 / N-2 / N-5，`uc-24-4` R3.2 / R7.1–R7.3 /
 * E1 / R12.1–3），及 R7.3「低置信标出而不是丢弃」。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 断言打在行为上，不是数量上（纪律第 9 条 / coding-standards E-4）
 * R12.1 逐字要求"阻断必须打在行为上（入库未发生），不是按钮的 disabled 属性"——
 * 本文件的对应做法：断言 `evaluatePromoteGates` 返回非 null 时，
 * `promoteConclusion` **完全不调用** `persistInsight`（用调用计数器核对，
 * 不是从返回值反推"应该没调用"）。
 */
import { describe, expect, it, vi } from "vitest";
import { research } from "@repo/contracts";
import {
  evaluatePromoteGates,
  buildCandidateInsight,
  promoteConclusion,
  CANDIDATE_STATUS_PENDING,
  type ConclusionForPromotion,
  type EvidenceT,
  type ResearchConflictT,
} from "../../src/domain/research/promote-insight";

function evidence(overrides: Partial<EvidenceT> & Pick<EvidenceT, "id">): EvidenceT {
  return {
    claim: "占位陈述",
    sourceKind: "官方",
    sourceRef: `src-${overrides.id}`,
    confidence: 0.9,
    disposition: "已引用",
    ...overrides,
  };
}

function conclusion(overrides: Partial<ConclusionForPromotion> & Pick<ConclusionForPromotion, "id">): ConclusionForPromotion {
  return {
    researchId: "r1",
    evidence: [evidence({ id: "e1" })],
    disputed: false,
    conflict: null,
    ...overrides,
  };
}

function conflict(overrides: Partial<ResearchConflictT> & Pick<ResearchConflictT, "id">): ResearchConflictT {
  return {
    researchId: "r1",
    statement: "行业报告说平均 7 个月，项目样本中位 9.5 个月",
    agentSuggestion: "建议以样本为准",
    actions: [...research.ConflictAction.options],
    resolution: null,
    ...overrides,
  };
}

const NODE_NONE = { decisionNodeRef: null, nodeExists: true } as const;

describe("F147 · 反空转：三个门控码互不相同，且都在契约的 err 面上", () => {
  it("NO_EXTERNAL_SOURCE / EVIDENCE_IS_DISPUTED / CONFLICT_PENDING_HUMAN 三码两两不同", () => {
    const codes = ["NO_EXTERNAL_SOURCE", "EVIDENCE_IS_DISPUTED", "CONFLICT_PENDING_HUMAN"];
    expect(new Set(codes).size).toBe(3);
  });

  it("三码都出现在契约 promoteConclusionToInsight.err 里，且 DECISION_NODE_GONE 不在其中（E2 的编译期反证）", () => {
    const err: readonly string[] = research.operations.promoteConclusionToInsight.err;
    expect(err).toContain("NO_EXTERNAL_SOURCE");
    expect(err).toContain("EVIDENCE_IS_DISPUTED");
    expect(err).toContain("CONFLICT_PENDING_HUMAN");
    expect(err).not.toContain("DECISION_NODE_GONE");
  });
});

describe("F147 · R7.1 / E1 · 无外部来源（证据为空）⇒ NO_EXTERNAL_SOURCE，且入库未发生", () => {
  it("evaluatePromoteGates 对空证据数组返回 NO_EXTERNAL_SOURCE", () => {
    const c = conclusion({ id: "c1", evidence: [] });
    expect(evaluatePromoteGates(c)).toBe("NO_EXTERNAL_SOURCE");
  });

  it("行为断言（不是 disabled 属性）：门控不过时 promoteConclusion 完全不调用 persistInsight", async () => {
    const persist = vi.fn();
    const c = conclusion({ id: "c1", evidence: [] });
    const result = await promoteConclusion(
      c,
      NODE_NONE,
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result).toEqual({ kind: "blocked", err: "NO_EXTERNAL_SOURCE" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("反证：证据非空（哪怕只有一条）就不触发本门控", () => {
    const c = conclusion({ id: "c1", evidence: [evidence({ id: "e1" })] });
    expect(evaluatePromoteGates(c)).not.toBe("NO_EXTERNAL_SOURCE");
  });
});

describe("F147 · R7.2 · 争议 / 不确定段的结论 ⇒ EVIDENCE_IS_DISPUTED，永不入库", () => {
  it("evaluatePromoteGates 对 disputed=true 返回 EVIDENCE_IS_DISPUTED（即便证据非空）", () => {
    const c = conclusion({ id: "c1", disputed: true, evidence: [evidence({ id: "e1" })] });
    expect(evaluatePromoteGates(c)).toBe("EVIDENCE_IS_DISPUTED");
  });

  it("行为断言：门控不过时不调用 persistInsight", async () => {
    const persist = vi.fn();
    const c = conclusion({ id: "c1", disputed: true });
    const result = await promoteConclusion(
      c,
      NODE_NONE,
      { insightId: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] },
      persist,
    );
    expect(result).toEqual({ kind: "blocked", err: "EVIDENCE_IS_DISPUTED" });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("F147 · N-5 · 冲突未经人判定 ⇒ CONFLICT_PENDING_HUMAN；已判定则放行", () => {
  it("conflict 非空且 resolution 为 null ⇒ CONFLICT_PENDING_HUMAN", () => {
    const c = conclusion({ id: "c1", conflict: conflict({ id: "cf1" }) });
    expect(evaluatePromoteGates(c)).toBe("CONFLICT_PENDING_HUMAN");
  });

  it("conflict 非空但 resolution 已由人填入 ⇒ 不触发本门控", () => {
    const resolved: ResearchConflictT = {
      ...conflict({ id: "cf1" }),
      resolution: { action: "以样本为准", actorUserId: "u-linke", resolvedAt: "2026-07-31T14:52:00Z" },
    };
    const c = conclusion({ id: "c1", conflict: resolved });
    expect(evaluatePromoteGates(c)).toBeNull();
  });

  it("conflict 为 null（不涉冲突）⇒ 不触发本门控", () => {
    const c = conclusion({ id: "c1", conflict: null });
    expect(evaluatePromoteGates(c)).toBeNull();
  });

  it("反证：EVIDENCE_IS_DISPUTED 与 CONFLICT_PENDING_HUMAN 是两条不同的判据——单独构造两个只触发各自那一条的结论", () => {
    const disputedOnly = conclusion({ id: "a", disputed: true, conflict: null });
    const conflictOnly = conclusion({ id: "b", disputed: false, conflict: conflict({ id: "cf1" }) });
    expect(evaluatePromoteGates(disputedOnly)).toBe("EVIDENCE_IS_DISPUTED");
    expect(evaluatePromoteGates(conflictOnly)).toBe("CONFLICT_PENDING_HUMAN");
  });
});

describe("F147 · R7.3 · 低置信（0.3）不阻断入库，且随候选洞察一起带过去（R12.3）", () => {
  it("反空转：含 0.3 低置信来源的结论确实能通过三道门槛", () => {
    const c = conclusion({ id: "c1", evidence: [evidence({ id: "e1", confidence: 0.3 })] });
    expect(evaluatePromoteGates(c)).toBeNull();
  });

  it("入库后的候选洞察上仍能读到该来源与其置信度（性质断言，不是过滤掉后计数为 0）", () => {
    const c = conclusion({
      id: "c1",
      evidence: [evidence({ id: "e-high", confidence: 0.9 }), evidence({ id: "e-low", confidence: 0.3 })],
    });
    const insight = buildCandidateInsight(c, { id: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] });
    const low = insight.evidence.find((e) => e.id === "e-low");
    expect(low, "低置信来源在入库后凭空消失了").not.toBeUndefined();
    expect(low?.confidence).toBe(0.3);
    expect(insight.evidence).toHaveLength(c.evidence.length);
  });
});

describe("F147 · R7.4 · 门控通过后产出的是「候选洞察」，状态含两串候选文案之一", () => {
  it("反空转：CANDIDATE_STATUS_PENDING 确实给出两个不同的候选值", () => {
    expect(new Set(CANDIDATE_STATUS_PENDING.values).size).toBe(2);
  });

  it("buildCandidateInsight 产出的 candidateStatus 恰是调用方指定的那一个候选值", () => {
    for (const status of CANDIDATE_STATUS_PENDING.values) {
      const c = conclusion({ id: "c1" });
      const insight = buildCandidateInsight(c, { id: "ins-1", candidateStatus: status });
      expect(insight.candidateStatus).toBe(status);
      expect(CANDIDATE_STATUS_PENDING.values).toContain(insight.candidateStatus);
    }
  });

  it("契约面 CandidateInsight.parse 接受该候选值（不是只在本域内自洽）", () => {
    const c = conclusion({ id: "c1" });
    const insight = buildCandidateInsight(c, { id: "ins-1", candidateStatus: CANDIDATE_STATUS_PENDING.values[0] });
    expect(() => research.CandidateInsight.parse(insight)).not.toThrow();
  });
});

describe("F147 · 三道门槛互斥且优先级稳定：一次只报一个码", () => {
  it("同时具备『无来源』与『争议』两个条件时，返回值恒是同一个码（NO_EXTERNAL_SOURCE 优先）", () => {
    const c = conclusion({ id: "c1", evidence: [], disputed: true });
    expect(evaluatePromoteGates(c)).toBe("NO_EXTERNAL_SOURCE");
  });
});
