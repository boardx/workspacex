/**
 * F94 —— 从众风险：附和不计入强度合计（`uc-6-5` R3 step5, AC5，R8 原型原文
 * 「P-11 对『责任归属』是在 P-10（其上级）发言后附和，标记为从众风险，不计入强度」）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 */
import { describe, expect, it } from "vitest";
import {
  computeCellStrength,
  tallyThemeStrength,
  type EvidenceCellFacts,
} from "../../src/domain/interview/evidence-matrix";

function cell(overrides: Partial<EvidenceCellFacts>): EvidenceCellFacts {
  return {
    hasQuotes: true,
    isCounterexample: false,
    isAppeasement: false,
    rawStrength: "strong",
    ...overrides,
  };
}

describe("F94 · AC5 · P-11 在 P-10 之后附和 ⇒ 落为 appeasement，且不计入强度", () => {
  it("P-11 的原始强度是 strong，但因为是下属在上级之后的呼应，最终格子值是 appeasement", () => {
    // P-10（上级）先发言，判定为强证据。
    const p10 = cell({ rawStrength: "strong" });
    // P-11（下属）在 P-10 之后附和同一观点——现场逐字稿已标「附和 · 非独立证据」。
    const p11 = cell({ isAppeasement: true, rawStrength: "strong" });

    expect(computeCellStrength(p10)).toBe("strong");
    expect(computeCellStrength(p11)).toBe("appeasement");
  });

  it("反证：若 P-11 的呼应没有被标为非独立证据，它会被误判为 strong——appeasement 覆盖正是防这个", () => {
    const p11WithoutAppeasementFlag = cell({ isAppeasement: false, rawStrength: "strong" });
    expect(computeCellStrength(p11WithoutAppeasementFlag)).toBe("strong");
  });
});

describe("F94 · AC5 · tallyThemeStrength 的强度合计不含 appeasement", () => {
  it("『责任归属无人承担』一行的强度合计：3 个 strong（P-04/P-07/P-10），不含 P-11 的 appeasement 与 P-12 的 counterexample", () => {
    const row = [
      cell({ rawStrength: "strong" }), // P-04 strong
      cell({ rawStrength: "strong" }), // P-07 strong
      cell({ hasQuotes: false, rawStrength: null }), // P-09 not-mentioned
      cell({ rawStrength: "strong" }), // P-10 strong
      cell({ isAppeasement: true, rawStrength: "strong" }), // P-11 appeasement（原始也是 strong！）
      cell({ isCounterexample: true, rawStrength: "weak" }), // P-12 counterexample
    ].map(computeCellStrength);

    const tally = tallyThemeStrength(row);
    expect(tally).toEqual({ strong: 3, weak: 0 });
  });

  it("反证：若 appeasement 被误计入合计，strong 会数成 4 而不是 3——本用例专门构造 P-11 原始强度为 strong 来暴露这个 bug", () => {
    const row = [
      cell({ rawStrength: "strong" }),
      cell({ isAppeasement: true, rawStrength: "strong" }),
    ].map(computeCellStrength);
    const tally = tallyThemeStrength(row);
    expect(tally.strong).not.toBe(2);
    expect(tally.strong).toBe(1);
  });

  it("附和格的 weak 原始强度同样不计入——appeasement 覆盖不区分底层是 strong 还是 weak", () => {
    const row = [cell({ isAppeasement: true, rawStrength: "weak" })].map(computeCellStrength);
    expect(tallyThemeStrength(row)).toEqual({ strong: 0, weak: 0 });
  });

  it("not-mentioned 与 counterexample 同样不计入强/弱合计", () => {
    const row = [
      cell({ hasQuotes: false, rawStrength: null }),
      cell({ isCounterexample: true, rawStrength: "strong" }),
    ].map(computeCellStrength);
    expect(tallyThemeStrength(row)).toEqual({ strong: 0, weak: 0 });
  });
});
