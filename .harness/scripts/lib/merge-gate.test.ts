// merge-gate.test.ts — #956 反证测试。
//
// issue 原文明确要求三种场景必须真的被拒绝：作者本人 APPROVE 自己的 PR、body
// 没有 `Closes #N`、只有 COMMENT 类型的 review。加一条正例证明满足三条的 PR
// 确实通过——否则"三条反证全绿"可能只是因为判定函数把所有输入都判成失败
// （本仓已九次栽在"全绿但空转"的门控上，见 MEMORY「workspacex 门控反证纪律」）。
import { describe, expect, it } from "vitest";
import { evaluateMergeGate, type MergeGateFacts } from "./merge-gate";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

/** 满足全部三条前置条件的基线事实。 */
function greenFacts(): MergeGateFacts {
  return {
    number: 956,
    author: "worker-agent",
    headSha: HEAD,
    body: "修复合并门禁\n\nCloses #956",
    labels: ["review:feature-ok"],
    reviews: [{ author: "rev-feature", state: "APPROVED", commit: HEAD }],
  };
}

describe("#956 机械合并门禁", () => {
  it("基线必须真的 passed（否则下面的反证全是空转）", () => {
    const got = evaluateMergeGate(greenFacts());
    expect(got.passed).toBe(true);
    expect(got.reasons).toEqual([]);
  });

  // ── issue 原文要求的三条反证 ──────────────────────────────────────────────
  it("反证 1：作者本人 APPROVE 自己的 PR → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "worker-agent", state: "APPROVED", commit: HEAD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("作者自审");
  });

  it("反证 2：body 没有 Closes #N → 拒绝", () => {
    const got = evaluateMergeGate({ ...greenFacts(), body: "修复合并门禁，没有关联 issue" });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("Closes #N");
  });

  it("反证 3：只有 COMMENT 类型的 review（不是真正的 APPROVE）→ 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "rev-feature", state: "COMMENTED", commit: HEAD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("没有独立 APPROVE");
  });

  it("正例：满足三条的 PR → 通过", () => {
    const got = evaluateMergeGate(greenFacts());
    expect(got.passed).toBe(true);
  });

  // ── 补充反证：覆盖 evaluateMergeGate 的其余分支，避免只测 issue 举的三例 ──
  it("反证 4：没有任何 verdict label → 拒绝", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: [] });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("没有任何 `review:*` verdict label");
  });

  it("反证 5：verdict label 不唯一（review:changes 与 review:feature-ok 并存）→ 拒绝", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: ["review:changes", "review:feature-ok"] });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("不唯一");
  });

  it("反证 6：APPROVE 锚在旧 SHA，head 已漂移 → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("已漂移");
  });

  it("反证 7：CHANGES_REQUESTED 不算 APPROVE → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "rev-feature", state: "CHANGES_REQUESTED", commit: HEAD }],
    });
    expect(got.passed).toBe(false);
  });

  it("reasons 收集全部命中项，不是只报第一条", () => {
    const got = evaluateMergeGate({
      number: 1,
      author: "worker-agent",
      headSha: HEAD,
      body: "没有关联 issue",
      labels: [],
      reviews: [{ author: "worker-agent", state: "APPROVED", commit: HEAD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.length).toBe(3);
  });
});
