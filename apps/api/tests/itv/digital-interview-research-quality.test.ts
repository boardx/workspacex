import { describe, expect, it } from "vitest";
import {
  assessBrief,
  assessExpertCoverage,
  assessQuestionQuality,
  assessReadiness,
  buildEvidenceCoverage,
  canApproveReport,
  estimateInterviewDuration,
} from "../../src/domain/interview/research-quality";

const brief = {
  decision: "决定是否优先优化采购审批链",
  learningGoals: [
    { goalId: "g1", statement: "识别审批阻塞" },
    { goalId: "g2", statement: "理解角色分歧" },
  ],
  targetRoles: ["采购负责人", "业务申请人"],
  outOfScope: ["市场规模"],
  successCriteria: ["每个目标有两种互补视角"],
};

const policy = {
  probingDepth: "balanced" as const,
  clarifyAmbiguity: true,
  seekCounterexamples: true,
  redirectOffTopic: true,
  stopWhenGoalSatisfied: true,
  maxFollowUpsPerQuestion: 2,
};

const question = (overrides: Record<string, unknown> = {}) => ({
  questionId: "q1", expertId: "e1", order: 1,
  text: "请回忆最近一次采购审批，哪个环节最影响进度？",
  purpose: "识别真实经历中的阻塞", section: "core" as const, goalIds: ["g1"],
  ...overrides,
});

const expert = (expertId: string, role: string, domains: string[], goals: string[]) => ({
  expertId, role, domains, goals, materialBoundary: "仅代表所给材料中的采购实践",
});

describe("数字访谈研究质量领域规则", () => {
  it("识别不完整研究简报", () => {
    expect(assessBrief({ ...brief, outOfScope: [] }).map((item) => item.code)).toContain("BRIEF_SCOPE_MISSING");
    expect(assessBrief(brief)).toEqual([]);
  });

  it.each([
    ["你是不是也认为这个流程太复杂？", "LEADING_WORDING"],
    ["你如何发现并解决这个问题？", "DOUBLE_BARRELLED"],
    ["你喜欢这个功能吗？", "YES_NO_ONLY"],
    ["审批流程中哪里最慢？", "MISSING_EXPERIENCE_ANCHOR"],
  ])("将问题“%s”识别为 %s", (text, code) => {
    expect(assessQuestionQuality({
      brief, questions: [question({ text })], selectedExpertIds: ["e1"],
    }).map((item) => item.code)).toContain(code);
  });

  it("识别缺失反例、重复意图、未覆盖目标和专家错配", () => {
    const findings = assessQuestionQuality({
      brief,
      selectedExpertIds: ["e1"],
      questions: [
        question(),
        question({ questionId: "q2", order: 2 }),
        question({ questionId: "q3", order: 3, expertId: "outside" }),
        question({ questionId: "q4", order: 4, section: "closing", text: "还有什么重要信息需要补充？" }),
      ],
    });
    expect(new Set(findings.map((item) => item.code))).toEqual(expect.objectContaining(new Set([
      "MISSING_COUNTEREXAMPLE", "DUPLICATE_INTENT", "GOAL_NOT_COVERED", "EXPERT_MISMATCH",
    ])));
  });

  it("要求每个目标有两种专家视角", () => {
    expect(assessExpertCoverage({ brief, experts: [] }).some((item) => item.severity === "blocking")).toBe(true);
    expect(assessExpertCoverage({
      brief,
      experts: [
        expert("e1", "采购负责人", ["审批阻塞"], ["审批阻塞"]),
        expert("e2", "业务申请人", ["角色分歧"], ["审批体验"]),
      ],
    }).filter((item) => item.code === "EXPERT_GOAL_UNCOVERED")).toEqual([]);
  });

  it("按追问深度估算时长并执行 8/35 分钟边界", () => {
    const light = estimateInterviewDuration({ questions: [question()], policy: { ...policy, probingDepth: "light" } });
    const deep = estimateInterviewDuration({ questions: [question()], policy: { ...policy, probingDepth: "deep" } });
    expect(deep.max).toBeGreaterThan(light.max);
    expect(light.issues.map((item) => item.code)).toContain("INTERVIEW_TOO_SHORT");
    const long = estimateInterviewDuration({
      questions: Array.from({ length: 20 }, (_, index) => question({ questionId: `q${index}`, order: index + 1 })),
      policy: { ...policy, probingDepth: "deep", maxFollowUpsPerQuestion: 10 },
    });
    expect(long.issues.map((item) => item.code)).toContain("INTERVIEW_TOO_LONG");
  });

  it("聚合 blocking、warning 和 ready 的就绪状态", () => {
    expect(assessReadiness({ briefIssues: [], expertIssues: [], questionIssues: [], durationIssues: [] }).status).toBe("ready");
    expect(assessReadiness({
      briefIssues: [{ code: "WARN", severity: "warning", message: "warning", objectId: null }],
      expertIssues: [], questionIssues: [], durationIssues: [],
    }).status).toBe("warning");
    expect(assessReadiness({
      briefIssues: [], expertIssues: [],
      questionIssues: [{ code: "BLOCK", severity: "blocking", message: "blocking", objectId: null }],
      durationIssues: [],
    }).status).toBe("blocking");
  });

  it("证据矩阵保留失败、单一视角与反例", () => {
    const cells = buildEvidenceCoverage({
      brief,
      expertIds: ["e1", "e2"],
      questions: [question(), question({ questionId: "q2", expertId: "e2", order: 2 })],
      runs: [
        { expertId: "e1", status: "completed" as const, answers: [{ questionId: "q1", answer: "通常会卡住，但上周有一次没有卡住" }] },
        { expertId: "e2", status: "failed" as const, answers: [] },
      ],
      findings: [{ expertId: "e1", questionId: "q1", goalIds: ["g1"], summary: "存在审批阻塞" }],
    });
    expect(cells.find((cell) => cell.expertId === "e1" && cell.goalId === "g1")).toMatchObject({
      answerCount: 1, findingCount: 1, counterexampleCount: 1, status: "contradicted",
    });
    expect(cells.find((cell) => cell.expertId === "e2" && cell.goalId === "g1")).toMatchObject({
      runStatus: "failed", status: "missing",
    });
  });

  it("阻止存在证据缺口或来源错配的报告批准", () => {
    expect(canApproveReport({ legacy: true, evidenceCoverage: [], sourceReferencesValid: true })).toEqual({
      allowed: false, blockingCodes: ["LEGACY_REPORT_UNREVIEWED"],
    });
    expect(canApproveReport({
      legacy: false,
      evidenceCoverage: [{ goalId: "g1", expertId: "e1", answerCount: 0, findingCount: 0, counterexampleCount: 0, runStatus: "failed", status: "missing" }],
      sourceReferencesValid: false,
    }).blockingCodes).toEqual(["REPORT_EVIDENCE_MISSING", "REPORT_EVIDENCE_INVALID"]);
  });
});
