import { describe, expect, it } from "vitest";
import {
  PR_GREEN_RULE_EFFECTIVE_FROM,
  judgeClosingPrGreen,
  reconstructMergeTimeChecks,
  type CheckRunObservation,
  type ClosingPr,
} from "./pr-green";
import { REQUIRED_CHECKS, classifyPr, type PrFacts } from "./pr-queue";

const AFTER = "2026-09-03T00:00:00Z";
const BEFORE = "2026-09-01T00:00:00Z";
const MERGED_AT = "2026-09-03T10:00:00Z";
const T = (min: number) => new Date(Date.parse(MERGED_AT) + min * 60_000).toISOString(); // 相对合入时刻的分钟

/** startedAtMin / completedAtMin 都相对合入时刻；completedAtMin 为 null = 观测时仍未完成 */
function run(name: string, conclusion: string | null, startedAtMin: number, completedAtMin: number | null = startedAtMin + 1): CheckRunObservation {
  return {
    name,
    status: completedAtMin === null ? "IN_PROGRESS" : "COMPLETED",
    conclusion: completedAtMin === null ? null : conclusion,
    startedAt: T(startedAtMin),
    completedAt: completedAtMin === null ? null : T(completedAtMin),
  };
}
function greenRuns(atMin = -30) {
  return REQUIRED_CHECKS.map((name) => run(name, "SUCCESS", atMin));
}
function pr(overrides: Partial<ClosingPr> = {}): ClosingPr {
  return { number: 100, merged: true, mergedAt: MERGED_AT, headSha: "a".repeat(40), runs: greenRuns(), ...overrides };
}
const judge = (prs: ClosingPr[], closedAt: string = AFTER) => judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: closedAt, closingPrs: prs });
const of = (checks: ReturnType<typeof reconstructMergeTimeChecks>, name: string) => checks.find((c) => c.name === name);

describe("reconstructMergeTimeChecks：只认合入前**完成**的结论（独立审 #2541 三轮）", () => {
  it("合入前开始、合入前完成 → 有效", () => {
    const checks = reconstructMergeTimeChecks([run("verify-affected", "SUCCESS", -20, -10)], MERGED_AT);
    expect(of(checks, "verify-affected")).toEqual({ name: "verify-affected", status: "COMPLETED", conclusion: "SUCCESS" });
  });

  it("合入前开始、合入后才 SUCCESS 完成 → 合入时是 pending，不是绿（确定性假绿的反例）", () => {
    const checks = reconstructMergeTimeChecks([run("verify-affected", "SUCCESS", -5, +10)], MERGED_AT);
    expect(of(checks, "verify-affected")).toEqual({ name: "verify-affected", status: "IN_PROGRESS", conclusion: null });
    expect(judge([pr({ runs: [...greenRuns().filter((r) => r.name !== "verify-affected"), run("verify-affected", "SUCCESS", -5, +10)] })]).kind).toBe("violation");
  });

  it("合入前失败完成、合入前 rerun 成功完成 → 以最后完成的为准", () => {
    const runs = [run("verify-affected", "FAILURE", -30, -25), run("verify-affected", "SUCCESS", -15, -10)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(reconstructMergeTimeChecks(runs, MERGED_AT).filter((c) => c.name === "verify-affected")).toHaveLength(1);
  });

  it("合入前完成的 SUCCESS + 一次合入前开始、合入后才完成的 rerun → 不覆盖合入时刻的结论", () => {
    const runs = [run("verify-affected", "SUCCESS", -30, -25), run("verify-affected", "FAILURE", -5, +10)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("SUCCESS");
  });

  it("观测时仍未完成（completedAt 为 null）的 run 同样不携带结论", () => {
    const runs = [run("verify-affected", "FAILURE", -30, -25), run("verify-affected", null, -5, null)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("FAILURE");
  });

  it("合入后才开始的 run（rerun / main push）一律忽略", () => {
    const runs = [...greenRuns(-30), run("verify-affected", "FAILURE", +15), run("e2e-full", "FAILURE", +20)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(of(checks, "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(of(checks, "e2e-full")).toBeUndefined();
  });

  it("合入前最后一次完成的是 FAILURE、合入后才 rerun 成功 → 合入时仍是红", () => {
    const runs = [run("verify-affected", "FAILURE", -10, -8), run("verify-affected", "SUCCESS", +5, +9)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("FAILURE");
  });

  it("与 pr-queue.classifyPr 对同一份合入时刻集合给出同一结论（单源反证）", () => {
    const runs = [...greenRuns(-40), run("verify-affected", "FAILURE", -30, -25), run("verify-affected", "SUCCESS", -15, -10)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    const facts: PrFacts = {
      number: 100, author: "a", isDraft: false, headSha: "a".repeat(40), closesIssues: [7], refsIssues: [],
      mergeStateStatus: "CLEAN", checks, verdictLabels: [], formalReviews: [],
    };
    expect(classifyPr(facts).reasons.filter((r) => r.includes("verify-affected"))).toEqual([]);
    expect(judge([pr({ runs })]).kind).toBe("ok");
  });
});

describe("judgeClosingPrGreen（完成定义第 7 条，#2539）", () => {
  it("生效时刻之前关闭的 issue 不倒查", () => {
    expect(Date.parse(PR_GREEN_RULE_EFFECTIVE_FROM)).not.toBeNaN();
    expect(judge([], BEFORE).kind).toBe("not-applicable");
  });

  it("没有 closedAt（未关闭 / 老 gh 不带字段）→ 不判", () => {
    expect(judgeClosingPrGreen({ issueNumber: 1, issueClosedAt: null, closingPrs: [] }).kind).toBe("not-applicable");
  });

  it("生效后关闭、却没有任何已合入的 PR → 违反「不许没有 PR 就关 issue」", () => {
    const v = judge([pr({ merged: false, mergedAt: null })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons[0]).toContain("没有任何已合入的 PR");
  });

  it("required 全 SUCCESS（合入前完成）、无其他红 → ok", () => {
    expect(judge([pr()])).toEqual({ kind: "ok", pr: 100 });
  });

  it("required FAILURE（合入前完成）→ violation，理由带 PR 号、SHA、合入时刻", () => {
    const v = judge([pr({ runs: [...greenRuns(), run("verify-control-plane", "FAILURE", -5)] })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons[0]).toMatch(/PR #100@aaaaaaaa（合入于 .*）：required check `verify-control-plane` 结论 FAILURE/);
  });

  it("非必需 check FAILURE 也算红（红就是红，与 classifyPr 同一语义）", () => {
    expect(judge([pr({ runs: [...greenRuns(), run("gates-test (2)", "FAILURE", -5)] })]).kind).toBe("violation");
  });

  it("required SKIPPED（空转）→ violation；非必需 SKIPPED 正常", () => {
    expect(judge([pr({ runs: [...greenRuns(), run("verify-affected", "SKIPPED", -5)] })]).kind).toBe("violation");
    expect(judge([pr({ runs: [...greenRuns(), run("e2e-full", "SKIPPED", -5)] })]).kind).toBe("ok");
  });

  it("required check 在合入前根本没跑（没跑不等于绿）→ violation", () => {
    const v = judge([pr({ runs: [] })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons.join("\n")).toContain("根本没有出现");
  });

  it("merged 却没有 mergedAt → unknown（不当绿，交给调用方按 strict 级别处理）", () => {
    expect(judge([pr({ mergedAt: null })]).kind).toBe("unknown");
  });
});
