/**
 * F62 · 满意度样本不足结构断言（`domain.md` I-21，`domain/skill/satisfaction.ts`）。
 *
 * 口径 `👍/(👍+👎)`，样本量（👍+👎 之和）低于最小样本量 ⇒ `value: null ∧ insufficient: true`，
 * **不返回百分比**——这条结构规则与最终数值无关（`thresholds.ts` 的
 * `skillSatisfactionMinSample` 仍是 `known: false`，本文件用**注入的任意阈值**验证结构，
 * 不硬编码某个「看起来合理」的数字）。
 *
 * ⚠ 造 9 条评价断言 `insufficient`；造第 10 条断言返回百分比——用两个不同的注入阈值
 *   （5 与 10）各跑一遍边界，证明规则不是围着某一个具体数字写的。
 */
import { describe, expect, it } from "vitest";
import { computeSatisfaction } from "../../../src/domain/skill/satisfaction";
import { THRESHOLDS, requireValue } from "@repo/contracts/thresholds";

describe("样本量低于最小样本量 ⇒ 「样本不足」而非百分比（I-21）", () => {
  it("阈值=10：9 条评价 ⇒ insufficient，value 为 null（不是 0，也不是估算值）", () => {
    const r = computeSatisfaction({ up: 6, down: 3 }, 10);
    expect(r.sampleSize).toBe(9);
    expect(r.insufficient).toBe(true);
    expect(r.value).toBeNull();
  });

  it("阈值=10：第 10 条评价把样本量顶到 10 ⇒ 返回真实百分比", () => {
    const r = computeSatisfaction({ up: 7, down: 3 }, 10);
    expect(r.sampleSize).toBe(10);
    expect(r.insufficient).toBe(false);
    expect(r.value).toBeCloseTo(0.7);
  });

  it("阈值=5（另一个注入值）：同一条结构规则不因数值而变——4 条不足，5 条足够", () => {
    expect(computeSatisfaction({ up: 2, down: 2 }, 5).insufficient).toBe(true);
    expect(computeSatisfaction({ up: 2, down: 2 }, 5).value).toBeNull();

    const enough = computeSatisfaction({ up: 3, down: 2 }, 5);
    expect(enough.insufficient).toBe(false);
    expect(enough.value).toBeCloseTo(0.6);
  });

  it("口径恒为 up/(up+down)：不含未评价、不加权（不是 up/总消息数之类的口径）", () => {
    const r = computeSatisfaction({ up: 9, down: 1 }, 10);
    expect(r.value).toBeCloseTo(0.9);
  });

  it("边界值 0 ⇒ 恒 insufficient（样本量 0 不该被当成『100% 满意』或『0% 满意』）", () => {
    const r = computeSatisfaction({ up: 0, down: 0 }, 1);
    expect(r.sampleSize).toBe(0);
    expect(r.insufficient).toBe(true);
    expect(r.value).toBeNull();
  });
});

describe("阈值登记表：数值仍待产品确认，生产路径不得静默用默认值（thresholds.ts）", () => {
  it("`skillSatisfactionMinSample` 仍是 `known: false`——本 feature 未替产品裁决数值", () => {
    expect(THRESHOLDS.skillSatisfactionMinSample.known).toBe(false);
  });

  it("`requireValue` 对未裁决阈值抛错，而不是悄悄返回一个默认数字", () => {
    expect(() =>
      requireValue(THRESHOLDS.skillSatisfactionMinSample, "skillSatisfactionMinSample"),
    ).toThrow(/尚未裁决/);
  });
});
