// merge-gate.test.ts — #956 反证测试。
//
// issue 原文明确要求三种场景必须真的被拒绝：作者本人 APPROVE 自己的 PR、body
// 没有 `Closes #N`、只有 COMMENT 类型的 review。加一条正例证明满足三条的 PR
// 确实通过——否则"三条反证全绿"可能只是因为判定函数把所有输入都判成失败
// （本仓已九次栽在"全绿但空转"的门控上，见 MEMORY「workspacex 门控反证纪律」）。
//
// 2026-08-16 第一次修正：条件 3（独立 approve）改为"GitHub 原生 APPROVE 或
// review:*-ok 标签，二者取一"。
//
// 2026-08-16 第二次修正（同一天，APPROVE_CHECK_SUSPENDED=true，见 pr-queue.ts
// 该常量定义处）：条件 3 整体暂停，只记录进 `advisories`，不再计入 `passed`/
// `reasons`。**本文件因此分成两层断言**：
//   · "反证 1/3/6/7" 这几条原本测"approve 信号不足该拒绝"——暂停后这些场景
//     应该 passed=true（因为没有别的东西挡），但 advisories 里必须仍然出现
//     对应的理由文案（"[已暂停，仅记录]" 前缀）。改成断言 advisories，而不是
//     删掉这些用例——删掉就等于承认"暂停之后这条检查的判断逻辑对不对已经没人
//     管了"，那不是事实：判断逻辑还在算，只是结论不拦人。
//   · 条件 1（Closes #N）、条件 2（label 唯一性）没有被这次暂停影响，测法不变。
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

  // ── issue 原文要求的三条反证（条件 3 已暂停，断言挪到 advisories）───────────
  it("反证 1：作者本人 APPROVE 自己的 PR——暂停期 passed=true，但 advisories 仍报出「作者自审」", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"], // 满足条件 2（恰好一个 label），但非 -ok，不触发条件 3 标签路径——只让"作者自审"这一条信号起作用
      reviews: [{ author: "worker-agent", state: "APPROVED", commit: HEAD }],
    });
    expect(got.passed).toBe(true); // 条件 1/2 都满足，条件 3 暂停不拦
    expect(got.reasons).toEqual([]);
    expect(got.advisories.join("\n")).toContain("作者自审");
  });

  it("反证 2：body 没有 Closes #N → 仍然拒绝（条件 1 未受暂停影响）", () => {
    const got = evaluateMergeGate({ ...greenFacts(), body: "修复合并门禁，没有关联 issue" });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("Closes #N");
  });

  it("反证 3：只有 COMMENT 类型的 review——暂停期 passed=true，但 advisories 仍报出", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"],
      reviews: [{ author: "rev-feature", state: "COMMENTED", commit: HEAD }],
    });
    expect(got.passed).toBe(true);
    expect(got.advisories.join("\n")).toContain("没有独立 APPROVE");
  });

  it("正例：满足三条的 PR → 通过", () => {
    const got = evaluateMergeGate(greenFacts());
    expect(got.passed).toBe(true);
  });

  // ── 补充反证：覆盖 evaluateMergeGate 的其余分支，避免只测 issue 举的三例 ──
  it("反证 4：没有任何 verdict label → 仍然拒绝（条件 2 未受暂停影响）", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: [] });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("没有任何 `review:*` verdict label");
  });

  it("反证 5：verdict label 不唯一 → 仍然拒绝（条件 2 未受暂停影响）", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: ["review:changes", "review:feature-ok"] });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("不唯一");
  });

  it("反证 6：APPROVE 锚在旧 SHA、head 已漂移——暂停期 passed=true，但 advisories 仍报出「已漂移」", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"],
      reviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.passed).toBe(true);
    expect(got.advisories.join("\n")).toContain("已漂移");
  });

  it("反证 7：CHANGES_REQUESTED 不算 APPROVE——暂停期 passed=true，advisories 仍报出", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"],
      reviews: [{ author: "rev-feature", state: "CHANGES_REQUESTED", commit: HEAD }],
    });
    expect(got.passed).toBe(true);
    expect(got.advisories.length).toBeGreaterThan(0);
  });

  it("reasons 收集全部命中项（条件 3 暂停后只剩条件 1+2，不是只报第一条）", () => {
    const got = evaluateMergeGate({
      number: 1,
      author: "worker-agent",
      headSha: HEAD,
      body: "没有关联 issue",
      labels: [],
      reviews: [{ author: "worker-agent", state: "APPROVED", commit: HEAD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.length).toBe(2); // Closes 缺失 + 没有 verdict label（条件 3 挪进 advisories，不算这里）
    expect(got.advisories.length).toBe(1); // 作者自审——仍然算出来了，只是不拦
  });

  // ── 2026-08-16 第一次修正：review:*-ok 标签可以单独满足条件 3（暂停前的行为，
  //    暂停后这条判断逻辑本身还在，只是结论不拦人——用例继续覆盖，不删）────────
  it("实测驱动：本仓最近 100 个已合并 PR 里 0 个有原生 APPROVE——只有标签、完全没有 reviews 也必须通过", () => {
    const got = evaluateMergeGate({ ...greenFacts(), reviews: [] });
    expect(got.passed).toBe(true);
    expect(got.reasons).toEqual([]);
    expect(got.advisories).toEqual([]); // 有 -ok 标签，条件 3 本身就满足，连 advisory 都不产生
  });

  it("review:changes 标签不能顶替 approve——暂停期 passed=true，但 advisories 仍如实报告", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"],
      reviews: [],
    });
    expect(got.passed).toBe(true); // 条件 3 暂停，不拦
    expect(got.advisories.join("\n")).toContain("没有独立 APPROVE review，也没有 review:*-ok 标签");
  });

  it("反证：review:e2e-ok 同样能单独满足（不只 feature-ok 一种 OK 档）", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: ["review:e2e-ok"], reviews: [] });
    expect(got.passed).toBe(true);
    expect(got.advisories).toEqual([]);
  });

  it("标签路径不做 head 漂移检查（已知的弱化点，用例把它钉住，不是意外发现）", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.passed).toBe(true);
    expect(got.advisories).toEqual([]); // 有标签就满足，不检查这条陈旧 review
  });
});
