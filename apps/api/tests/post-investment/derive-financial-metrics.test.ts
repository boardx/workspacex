/**
 * `/agent/team4` —— 派生数值参照实现的回归防护网。
 *
 * 断言用的全是《投后管理报告AI生成场景 测试方案 V1.0》里 A/B/C 三包材料的**真实
 * 数字**，不是编出来的圆整数：公式改坏时，红的是"云帆的资本化率不再是 80%"这种
 * 能直接对回材料的事实，而不是一个抽象的样例。
 *
 * 阈值判定函数一并测：它们从 `@repo/contracts/post-investment-rules` 读阈值，这里
 * 验证"越线/不越线"两侧都对——只测越线一侧的话，把阈值写成 0 也能全绿。
 */
import { describe, expect, it } from "vitest";
import { SELF_CHECK_CASES, type SelfCheckCase } from "@repo/contracts/post-investment-rules";
import {
  capitalizationRate,
  cashRunwayMonths,
  computeYoyPct,
  concentrationRatio,
  isCapitalizationAbnormal,
  isCustomerConcentrationHigh,
  isMilestoneDelayed,
  isRelatedPartyPriceSuspect,
  isRevenueProfitDivergent,
  isSubsidyDependent,
  parseNumericValue,
  relatedPartyPriceGapPct,
  runwayGapMonths,
} from "../../src/application/post-investment/derive-financial-metrics";

describe("parseNumericValue", () => {
  it("解析材料里的常见写法（千分位/正负号/小数/百分号）", () => {
    expect(parseNumericValue("4,680万元")).toBe(4680);
    expect(parseNumericValue("-860万元")).toBe(-860);
    expect(parseNumericValue("29.5%")).toBe(29.5);
  });

  it("抽不出数字 ⇒ null（不猜）", () => {
    expect(parseNumericValue("未披露")).toBeNull();
    expect(parseNumericValue("")).toBeNull();
  });
});

describe("测试文件 A · 云帆智能 2025Q2", () => {
  it("A-R01 营收同比：4,680 万 vs 3,960 万 ≈ +18.2%", () => {
    expect(computeYoyPct("4,680万元", "3,960万元")).toBeCloseTo(18.2, 1);
  });

  it("A-R01 净利润同比：385 万 vs 567 万 ≈ -32.1%，且判定为增收不增利", () => {
    const profitYoy = computeYoyPct("385万元", "567万元");
    expect(profitYoy).toBeCloseTo(-32.1, 0);
    expect(isRevenueProfitDivergent(18.2, profitYoy)).toBe(true);
  });

  it("A-R03 研发资本化率：960 / 1,200 = 80%，超出行业 30%-50% 区间", () => {
    const rate = capitalizationRate(960, 1200);
    expect(rate).toBe(80);
    expect(isCapitalizationAbnormal(rate)).toBe(true);
    // 区间内不得误报——只测越线一侧的话，阈值写错也能全绿。
    expect(isCapitalizationAbnormal(40)).toBe(false);
  });

  it("对比期缺失 / 除零 ⇒ null，不编造同比", () => {
    expect(computeYoyPct("385万元", null)).toBeNull();
    expect(computeYoyPct("385万元", "0")).toBeNull();
    expect(capitalizationRate(960, 0)).toBeNull();
  });
});

describe("测试文件 B · 星瀚新材料 2025H1", () => {
  it("B-R01 客户集中度：锐驰 5,120 万 / 13,400 万 ≈ 38%，且前五大 72% 越线", () => {
    // 2024 年度口径：锐驰实际采购 5,120 万，占当年总营收 38%（材料备注）。
    const top1 = concentrationRatio(5120, 13473);
    expect(top1).toBeCloseTo(38, 0);
    expect(isCustomerConcentrationHigh(top1, 72)).toBe(true);
    // 两个阈值都不越线时不得误报。
    expect(isCustomerConcentrationHigh(25, 55)).toBe(false);
  });

  it("B-R03 关联方价差率：14.2 vs 18.2 元/kg ≈ 22%，越过 10% 阈值", () => {
    const gap = relatedPartyPriceGapPct(14.2, 18.2);
    expect(gap).toBeCloseTo(22, 0);
    expect(isRelatedPartyPriceSuspect(gap)).toBe(true);
    expect(isRelatedPartyPriceSuspect(8)).toBe(false);
  });

  it("B-R05 补助依赖：1,150 万 / 2,400 万 ≈ 48%，越过 30% 阈值", () => {
    expect(isSubsidyDependent(1150, 2400)).toBe(true);
    expect(isSubsidyDependent(500, 2400)).toBe(false);
  });

  it("B-R02 存货同比：2,100 万 → 3,465 万 = +65%", () => {
    expect(computeYoyPct(3465, 2100)).toBeCloseTo(65, 0);
  });
});

describe("测试文件 C · 澜起生物医药", () => {
  it("C-R02 现金跑道：4,200 万 ÷ 月均 680 万 ≈ 6.2 个月", () => {
    // 月均经营净流出 = 2025H1 研发 3,200 + 管理 880 = 4,080 万 / 6 个月 = 680 万。
    const monthly = 4080 / 6;
    expect(monthly).toBe(680);
    const runway = cashRunwayMonths(4200, monthly);
    expect(runway).toBeCloseTo(6.2, 1);
  });

  it("C-R02 缺口月数：III 期尚需 14 个月 − 跑道 6.2 个月 ≈ 7.8 个月缺口", () => {
    const runway = cashRunwayMonths(4200, 680);
    expect(runwayGapMonths(14, runway)).toBeCloseTo(7.8, 1);
    // 跑道够长时缺口为负（不是缺口）。
    expect(runwayGapMonths(14, 24)).toBeLessThan(0);
  });

  it("C-R01 里程碑滞后：入组 218 / 计划 360 = 60.6%，滞后超 30%", () => {
    expect(concentrationRatio(218, 360)).toBeCloseTo(60.6, 1);
    expect(isMilestoneDelayed(218, 360)).toBe(true);
    // 完成率 80%（滞后 20%）不该报。
    expect(isMilestoneDelayed(288, 360)).toBe(false);
  });

  it("净流出非正 ⇒ 跑道 null（没有烧钱速度可言，不是「无限长」）", () => {
    expect(cashRunwayMonths(4200, 0)).toBeNull();
    expect(cashRunwayMonths(4200, -100)).toBeNull();
    expect(runwayGapMonths(14, null)).toBeNull();
  });
});

/**
 * 方法论正文里给模型的自检算例，必须与参照实现真算出来的一致。
 *
 * 这条测试的价值不在"公式对不对"（上面已经测过），而在「我们告诉模型的正确答案本身
 * 是不是对的」：方法论要求模型写完脚本先跑这几个算例，跑不出就"说明脚本有误，先修
 * 脚本"。如果这里的期望值本身写错了，模型会照着错的目标去改自己本来正确的脚本——
 * 越修越错，而且从对话里完全看不出问题出在哪。
 */
describe("自检算例（方法论与参照实现同源）", () => {
  it("每条 SELF_CHECK_CASE 的 expected 都能被参照实现在容差内复现", () => {
    /** 取一个输入项；缺了就红（算例声明不全也是缺陷，不该静默当 undefined 算）。 */
    const arg = (c: SelfCheckCase, key: string): number => {
      const v = c.inputs[key];
      expect(typeof v, `SELF_CHECK_CASES.${c.id} 缺少输入项 ${key}`).toBe("number");
      return v as number;
    };

    expect(SELF_CHECK_CASES.length).toBeGreaterThan(0);
    for (const c of SELF_CHECK_CASES) {
      const actual =
        c.id === "yoy" ? computeYoyPct(arg(c, "current"), arg(c, "prior"))
        : c.id === "capitalization" ? capitalizationRate(arg(c, "capitalized"), arg(c, "total"))
        : c.id === "runway" ? cashRunwayMonths(arg(c, "cash"), arg(c, "monthlyOutflow"))
        : null;
      // 新增算例却忘了在这里接上对应函数 ⇒ actual 为 null ⇒ 红，而不是静默跳过。
      expect(actual, `SELF_CHECK_CASES 里的 ${c.id} 没有接上参照实现`).not.toBeNull();
      expect(Math.abs((actual as number) - c.expected)).toBeLessThanOrEqual(c.tolerance);
    }
  });
});
