import { describe, expect, it } from "vitest";
import {
  PR_GREEN_RULE_EFFECTIVE_FROM,
  commitStatusToObservation,
  judgeClosingPrGreen,
  reconstructMergeTimeChecks,
  type CheckRunObservation,
  type ClosingPr,
} from "./pr-green";
import { REQUIRED_CHECKS, classifyPr, type PrFacts, type RequiredCheck } from "./pr-queue";

const AFTER = "2026-09-03T00:00:00Z";
const BEFORE = "2026-09-01T00:00:00Z";
const MERGED_AT = "2026-09-03T10:00:00Z";
const T = (min: number) => new Date(Date.parse(MERGED_AT) + min * 60_000).toISOString(); // 相对合入时刻的分钟

let nextId = 1;
/** startedAtMin / completedAtMin 都相对合入时刻；completedAtMin 为 null = 观测时仍未完成。id 按构造顺序递增。 */
function run(name: string, conclusion: string | null, startedAtMin: number, completedAtMin: number | null = startedAtMin + 1, id = nextId++): CheckRunObservation {
  return {
    id,
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
const of = (checks: RequiredCheck[], name: string) => checks.find((c) => c.name === name);
/** 与 pr-queue 的对照：同一份合入时刻集合喂 classifyPr，看它对某个 check 的判定 */
function prQueueReasonsFor(checks: RequiredCheck[], name: string): string[] {
  const facts: PrFacts = {
    number: 100, author: "a", isDraft: false, headSha: "a".repeat(40), closesIssues: [7], refsIssues: [],
    mergeStateStatus: "CLEAN", checks, verdictLabels: [], formalReviews: [],
  };
  return classifyPr(facts).reasons.filter((r) => r.includes(`\`${name}\``));
}
const withVA = (...va: CheckRunObservation[]) => [...greenRuns().filter((r) => r.name !== "verify-affected"), ...va];

describe("reconstructMergeTimeChecks：合入时刻已开始的最新 attempt 说了算（独立审 #2541 四轮）", () => {
  it("合入前开始并完成 → 用它的终态结论", () => {
    const checks = reconstructMergeTimeChecks([run("verify-affected", "SUCCESS", -20, -10)], MERGED_AT);
    expect(of(checks, "verify-affected")).toEqual({ name: "verify-affected", status: "COMPLETED", conclusion: "SUCCESS" });
  });

  it("合入前开始、合入后才 SUCCESS 完成 → 合入时是 pending，不是绿（确定性假绿的反例）", () => {
    const checks = reconstructMergeTimeChecks([run("verify-affected", "SUCCESS", -5, +10)], MERGED_AT);
    expect(of(checks, "verify-affected")).toEqual({ name: "verify-affected", status: "IN_PROGRESS", conclusion: null });
    expect(judge([pr({ runs: withVA(run("verify-affected", "SUCCESS", -5, +10)) })]).kind).toBe("violation");
  });

  it("旧 attempt 合入前 SUCCESS + 更新的 rerun 合入时仍在跑 → 合入时是 pending，违反第 7 条（不退回旧的绿）", () => {
    const runs = withVA(run("verify-affected", "SUCCESS", -30, -25), run("verify-affected", "SUCCESS", -5, +10));
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(of(checks, "verify-affected")).toEqual({ name: "verify-affected", status: "IN_PROGRESS", conclusion: null });
    expect(prQueueReasonsFor(checks, "verify-affected").join("\n")).toContain("还没有结论");
    const v = judge([pr({ runs })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons.join("\n")).toContain("还没有结论");
  });

  it("旧 attempt 合入前 SUCCESS + 更新的 rerun 观测时仍未完成（completedAt null）→ 同样 pending", () => {
    const checks = reconstructMergeTimeChecks(withVA(run("verify-affected", "SUCCESS", -30, -25), run("verify-affected", null, -5, null)), MERGED_AT);
    expect(of(checks, "verify-affected")?.conclusion).toBeNull();
  });

  it("合入前失败完成 + 更新的 rerun 合入前成功完成 → 最新 attempt 胜出（不会永远违反）", () => {
    const runs = withVA(run("verify-affected", "FAILURE", -30, -25), run("verify-affected", "SUCCESS", -15, -10));
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(of(checks, "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(checks.filter((c) => c.name === "verify-affected")).toHaveLength(1);
    expect(prQueueReasonsFor(checks, "verify-affected")).toEqual([]);
    expect(judge([pr({ runs })]).kind).toBe("ok");
  });

  it("重叠的 attempt：旧的完成得晚、新的开始得晚 → 按开始时刻取新的，不按完成时刻", () => {
    // A 开始 -30 完成 -5（慢），B 开始 -20 完成 -15（快）：合入时 GitHub 展示的是 B（更新的 attempt）
    const runs = [run("verify-affected", "FAILURE", -30, -5), run("verify-affected", "SUCCESS", -20, -15)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("SUCCESS");
  });

  it("同一 startedAt 的两条 attempt → id 大的新", () => {
    const older = run("verify-affected", "FAILURE", -20, -15, 10);
    const newer = run("verify-affected", "SUCCESS", -20, -15, 11);
    expect(of(reconstructMergeTimeChecks([newer, older], MERGED_AT), "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(of(reconstructMergeTimeChecks([older, newer], MERGED_AT), "verify-affected")?.conclusion).toBe("SUCCESS");
  });

  it("合入后才开始的 run（rerun / main push）一律忽略——合入时绿就是绿", () => {
    const runs = [...greenRuns(-30), run("verify-affected", "FAILURE", +15), run("e2e-full", "FAILURE", +20)];
    const checks = reconstructMergeTimeChecks(runs, MERGED_AT);
    expect(of(checks, "verify-affected")?.conclusion).toBe("SUCCESS");
    expect(of(checks, "e2e-full")).toBeUndefined();
  });

  it("合入前最后一次完成的是 FAILURE、合入后才 rerun 成功 → 合入时仍是红", () => {
    const runs = [run("verify-affected", "FAILURE", -10, -8), run("verify-affected", "SUCCESS", +5, +9)];
    expect(of(reconstructMergeTimeChecks(runs, MERGED_AT), "verify-affected")?.conclusion).toBe("FAILURE");
  });
});

describe("commit status（StatusContext）与 check run 同规则重建（独立审 #2541 五轮意见 2）", () => {
  const status = (context: string, state: string, atMin: number, id?: number) => commitStatusToObservation({ id, context, state, createdAt: T(atMin) });

  it("映射与 pr-queue 活 rollup 同一处：state 即 conclusion，createdAt 既是开始也是完成", () => {
    expect(status("coord/andon", "FAILURE", -3, 7)).toEqual({ id: 7, name: "coord/andon", status: "COMPLETED", conclusion: "FAILURE", startedAt: T(-3), completedAt: T(-3) });
    expect(commitStatusToObservation({ context: "x", state: null, createdAt: null })).toMatchObject({ status: "UNKNOWN", conclusion: null });
  });

  it("合入前打上的 failure status → 红就是红，violation 理由带 context 名", () => {
    const v = judge([pr({ runs: [...greenRuns(), status("coord/andon", "FAILURE", -3)] })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons.join("\n")).toContain("`coord/andon` 结论 FAILURE");
  });

  it("同一 context 合入前 failure → 合入前 success：最后一次说了算 → ok；合入后才 failure → 无关 → ok", () => {
    expect(judge([pr({ runs: [...greenRuns(), status("coord/andon", "FAILURE", -8), status("coord/andon", "SUCCESS", -2)] })]).kind).toBe("ok");
    expect(judge([pr({ runs: [...greenRuns(), status("coord/andon", "FAILURE", +7)] })]).kind).toBe("ok");
  });

  it("合入前 success → 合入后又打 failure 覆盖不了合入时刻；合入前 success → 合入前 failure 则违反", () => {
    expect(judge([pr({ runs: [...greenRuns(), status("coord/andon", "SUCCESS", -5), status("coord/andon", "FAILURE", +1)] })]).kind).toBe("ok");
    expect(judge([pr({ runs: [...greenRuns(), status("coord/andon", "SUCCESS", -5), status("coord/andon", "FAILURE", -1)] })]).kind).toBe("violation");
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
    const v = judge([pr({ runs: withVA(run("verify-affected", "FAILURE", -5)) })]);
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons[0]).toMatch(/PR #100@aaaaaaaa（合入于 .*）：required check `verify-affected` 结论 FAILURE/);
  });

  it("非必需 check FAILURE 也算红（红就是红，与 classifyPr 同一语义）", () => {
    expect(judge([pr({ runs: [...greenRuns(), run("gates-test (2)", "FAILURE", -5)] })]).kind).toBe("violation");
  });

  it("required SKIPPED（空转）→ violation；非必需 SKIPPED 正常", () => {
    expect(judge([pr({ runs: withVA(run("verify-affected", "SKIPPED", -5)) })]).kind).toBe("violation");
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
