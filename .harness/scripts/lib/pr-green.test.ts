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

function run(name: string, conclusion: string | null, startedAtMin: number, status = "COMPLETED"): CheckRunObservation {
  return { name, status, conclusion, startedAt: T(startedAtMin) };
}
function greenRuns(atMin = -30) {
  return REQUIRED_CHECKS.map((name) => run(name, "SUCCESS", atMin));
}
function pr(overrides: Partial<ClosingPr> = {}): ClosingPr {
  return { number: 100, merged: true, mergedAt: MERGED_AT, headSha: "a".repeat(40), runs: greenRuns(), ...overrides };
}
const judge = (prs: ClosingPr[], closedAt: string = AFTER) => judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: closedAt, closingPrs: prs });

describe("reconstructMergeTimeChecks：只看合入前、同名取最晚（独立审 #2541 意见 1/2）", () => {
  it("合入前失败、合入前 rerun 成功 → 以 rerun 为准（不会永远违反）", () => {
    const runs = [...greenRuns(-40), run("verify-affected", "FAILURE", -30), run("verify-affected", "SUCCESS", -10)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(checks.find((c) => c.name === "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(checks.filter((c) => c.name === "verify-affected")).toHaveLength(1);
  });

  it("合入后追加的 run（rerun / main push）一律忽略——合入时绿就是绿", () => {
    const runs = [...greenRuns(-30), run("verify-affected", "FAILURE", +15), run("e2e-full", "FAILURE", +20)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(checks.find((c) => c.name === "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(checks.find((c) => c.name === "e2e-full")).toBeUndefined();
  });

  it("合入前最后一次是 FAILURE、合入后才 rerun 成功 → 合入时仍是红", () => {
    const runs = [...greenRuns(-40), run("verify-affected", "FAILURE", -10), run("verify-affected", "SUCCESS", +5)];
    expect(reconstructMergeTimeChecks(runs, MERGED_AT).find((c) => c.name === "verify-affected")?.conclusion).toBe("FAILURE");
  });

  it("与 pr-queue.classifyPr 对同一份合入时刻集合给出同一结论（单源反证）", () => {
    const runs = [...greenRuns(-40), run("verify-affected", "FAILURE", -30), run("verify-affected", "SUCCESS", -10)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    const facts: PrFacts = {
      number: 100, author: "a", isDraft: false, headSha: "a".repeat(40), closesIssues: [7], refsIssues: [],
      mergeStateStatus: "CLEAN", checks, verdictLabels: [], formalReviews: [],
    };
    const c = classifyPr(facts);
    expect(c.reasons.filter((r) => r.includes("verify-affected"))).toEqual([]);
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

  it("required 全 SUCCESS、无其他红 → ok", () => {
    expect(judge([pr()])).toEqual({ kind: "ok", pr: 100 });
  });

  it("required FAILURE（合入时）→ violation，理由带 PR 号、SHA、合入时刻", () => {
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
