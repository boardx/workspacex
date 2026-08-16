// merge-gate.test.ts — #956 反证测试。
//
// issue 原文明确要求三种场景必须真的被拒绝：作者本人 APPROVE 自己的 PR、body
// 没有 `Closes #N`、只有 COMMENT 类型的 review。加一条正例证明满足三条的 PR
// 确实通过——否则"三条反证全绿"可能只是因为判定函数把所有输入都判成失败
// （本仓已九次栽在"全绿但空转"的门控上，见 MEMORY「workspacex 门控反证纪律」）。
//
// 2026-08-16：条件 3（独立 approve）改为"GitHub 原生 APPROVE 或 review:*-ok
// 标签，二者取一"（见 merge-gate.ts 文件头说明）。原本测"只有原生 review 信号
// 弱/缺失该拒绝"的几条用例（反证 3/6/7）显式把 labels 清空，隔离出"只看
// reviews 字段"这条路径——否则 greenFacts() 自带的 review:feature-ok 标签会
// 让新的标签兜底把这些场景判成通过，测试就测不到原来要测的东西了。
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
  it("反证 1：作者本人 APPROVE 自己的 PR，且没有 -ok 标签兜底 → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: [], // 隔离：只让"作者自审"这一条信号起作用
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

  it("反证 3：只有 COMMENT 类型的 review，且没有 -ok 标签兜底 → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: [], // 隔离：只让"COMMENT 不算 APPROVE"这一条信号起作用
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

  it("反证 6：APPROVE 锚在旧 SHA、head 已漂移，且没有 -ok 标签兜底 → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: [], // 隔离：只让"head 漂移"这一条信号起作用
      reviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.passed).toBe(false);
    expect(got.reasons.join("\n")).toContain("已漂移");
  });

  it("反证 7：CHANGES_REQUESTED 不算 APPROVE，且没有 -ok 标签兜底 → 拒绝", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: [],
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

  // ── 2026-08-16 新行为：review:*-ok 标签可以单独满足条件 3 ─────────────────
  it("实测驱动：本仓最近 100 个已合并 PR 里 0 个有原生 APPROVE——只有标签、完全没有 reviews 也必须通过", () => {
    // 这条用例直接对应实测证据：如果这条不通过，merge-gate 就会像修复前一样，
    // 对本仓实际发生过的每一个 PR 都判 FAIL，不管它有没有真的走过 review。
    const got = evaluateMergeGate({ ...greenFacts(), reviews: [] });
    expect(got.passed).toBe(true);
    expect(got.reasons).toEqual([]);
  });

  it("反证：只有 review:changes 标签（不是 -ok）不能顶替 approve", () => {
    const got = evaluateMergeGate({
      ...greenFacts(),
      labels: ["review:changes"],
      reviews: [],
    });
    expect(got.passed).toBe(false);
    // 命中的应该是"没有独立 APPROVE...也没有 review:*-ok 标签"，不是被 review:changes 蒙混过关
    expect(got.reasons.join("\n")).toContain("没有独立 APPROVE review，也没有 review:*-ok 标签");
  });

  it("反证：review:e2e-ok 同样能单独满足（不只 feature-ok 一种 OK 档）", () => {
    const got = evaluateMergeGate({ ...greenFacts(), labels: ["review:e2e-ok"], reviews: [] });
    expect(got.passed).toBe(true);
  });

  it("标签路径不做 head 漂移检查（已知的弱化点，用例把它钉住，不是意外发现）", () => {
    // 标签没有快照 SHA 的概念；只要标签在、且是 -ok，就算通过，即使 reviews
    // 数组里恰好有一条锚在旧 SHA 的记录。这是文件头写明的"已知更弱"，不是 bug。
    const got = evaluateMergeGate({
      ...greenFacts(),
      reviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.passed).toBe(true);
  });
});
