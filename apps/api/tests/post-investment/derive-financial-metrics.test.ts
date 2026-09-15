/**
 * ad-hoc MVP（`/agent/team4`）—— 派生数值必须是纯函数，不依赖模型心算：
 * S1（数据准确率）与验收 E-4（同一材料重跑三次数值一致）都靠这一层守住。
 */
import { describe, expect, it } from "vitest";
import { computeYoyPct, parseNumericValue } from "../../src/application/post-investment/derive-financial-metrics";

describe("parseNumericValue", () => {
  it("解析常见材料写法（千分位、正负号、小数、百分号）", () => {
    expect(parseNumericValue("4,680万元")).toBe(4680);
    expect(parseNumericValue("-860万元")).toBe(-860);
    expect(parseNumericValue("29.5%")).toBe(29.5);
    expect(parseNumericValue("385")).toBe(385);
  });

  it("抽不出数字 ⇒ null（不猜）", () => {
    expect(parseNumericValue("未披露")).toBeNull();
    expect(parseNumericValue("")).toBeNull();
  });
});

describe("computeYoyPct", () => {
  it("测试文件 A：净利润同比 385 万 vs 上年同期约 567 万 ≈ -32%", () => {
    // 385 = 567 * (1 - 0.321)，取整数验证同比公式方向与幅度都对。
    expect(computeYoyPct("385万元", "567万元")).toBeCloseTo(-32.1, 0);
  });

  it("测试文件 A：营收同比 4,680 万 vs 上年同期约 3,960 万 ≈ +18%", () => {
    expect(computeYoyPct("4680万元", "3960万元")).toBeCloseTo(18.2, 0);
  });

  it("基期为 null / 抽不出数字 / 除零 ⇒ null，不编造同比", () => {
    expect(computeYoyPct("385万元", null)).toBeNull();
    expect(computeYoyPct("未披露", "567万元")).toBeNull();
    expect(computeYoyPct("385万元", "0")).toBeNull();
  });

  it("同一输入重复计算结果完全一致（验收 E-4：确定性计算，不是模型心算）", () => {
    const a = computeYoyPct("-860万元", "420万元");
    const b = computeYoyPct("-860万元", "420万元");
    const c = computeYoyPct("-860万元", "420万元");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
