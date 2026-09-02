import { describe, expect, it } from "vitest";
import { PR_GREEN_RULE_EFFECTIVE_FROM, judgeClosingPrGreen, type ClosingPr } from "./pr-green";
import { REQUIRED_CHECKS } from "./pr-queue";

const AFTER = "2026-09-03T00:00:00Z";
const BEFORE = "2026-09-01T00:00:00Z";

function greenChecks() {
  return REQUIRED_CHECKS.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));
}
function pr(overrides: Partial<ClosingPr> = {}): ClosingPr {
  return { number: 100, merged: true, headSha: "a".repeat(40), checks: greenChecks(), ...overrides };
}

describe("judgeClosingPrGreen（完成定义第 7 条，#2539 / #2540）", () => {
  it("生效时刻之前关闭的 issue 不倒查", () => {
    expect(Date.parse(PR_GREEN_RULE_EFFECTIVE_FROM)).not.toBeNaN();
    const v = judgeClosingPrGreen({ issueNumber: 1, issueClosedAt: BEFORE, closingPrs: [] });
    expect(v.kind).toBe("not-applicable");
  });

  it("没有 closedAt（未关闭 / 老 gh 不带字段）→ 不判", () => {
    expect(judgeClosingPrGreen({ issueNumber: 1, issueClosedAt: null, closingPrs: [] }).kind).toBe("not-applicable");
  });

  it("生效后关闭、却没有任何已合入的 PR → 违反「不许没有 PR 就关 issue」", () => {
    const v = judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ merged: false })] });
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons[0]).toContain("没有任何已合入的 PR");
  });

  it("required check 全 SUCCESS、无其他红 → ok", () => {
    const v = judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr()] });
    expect(v).toEqual({ kind: "ok", pr: 100 });
  });

  it("required check FAILURE → violation（理由带 PR 号与 SHA）", () => {
    const checks = greenChecks();
    checks[0] = { ...checks[0]!, conclusion: "FAILURE" };
    const v = judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ checks })] });
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons[0]).toMatch(/PR #100@aaaaaaaa：required check `verify-control-plane` 结论 FAILURE/);
  });

  it("非必需 check FAILURE 也算红（红就是红，与 classifyPr 同一语义）", () => {
    const checks = [...greenChecks(), { name: "gates-test (2)", status: "COMPLETED", conclusion: "FAILURE" }];
    const v = judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ checks })] });
    expect(v.kind).toBe("violation");
  });

  it("required check SKIPPED（空转）→ violation；非必需 SKIPPED 正常", () => {
    const skippedRequired = greenChecks();
    skippedRequired[1] = { ...skippedRequired[1]!, conclusion: "SKIPPED" };
    expect(judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ checks: skippedRequired })] }).kind).toBe("violation");
    const skippedOptional = [...greenChecks(), { name: "e2e-full", status: "COMPLETED", conclusion: "SKIPPED" }];
    expect(judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ checks: skippedOptional })] }).kind).toBe("ok");
  });

  it("required check 根本没出现在 head 上（没跑不等于绿）→ violation", () => {
    const v = judgeClosingPrGreen({ issueNumber: 7, issueClosedAt: AFTER, closingPrs: [pr({ checks: [] })] });
    expect(v.kind).toBe("violation");
    if (v.kind === "violation") expect(v.reasons.join("\n")).toContain("根本没有出现");
  });
});
