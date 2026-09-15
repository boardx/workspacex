import { describe, expect, it } from "vitest";
import {
  cashScore,
  computeS1,
  computeS2,
  computeS3,
  downgradeTrigger,
  gradeFromTotal,
  profitGrowthScore,
  profitLevelScore,
  rate,
  rateWithDataQuality,
  revenueGrowthScore,
  revenueSizeScore,
  suspectedAbnormalFlag,
  type FinancialInput,
  type HumanConfirmedFacts,
} from "../../src/domain/postinvest-rating/scoring";

/** 一份"正常"的基线输入：全部字段齐全、非异常，供各测试局部覆盖。 */
function baseInput(overrides: Partial<FinancialInput> = {}): FinancialInput {
  return {
    revenue: 6e8,
    revenuePriorYear: 5e8,
    netProfit: 6e7,
    netProfitPriorYear: 5e7,
    cashAndEquivalents: 2e8,
    operatingCashOutflow12m: 1e8,
    operatingCashFlowNet: 3e7,
    accountsReceivable: 5e7,
    inventory: 3e7,
    otherReceivables: 1e7,
    otherReceivablesPriorYear: 8e6,
    totalAssets: 1e9,
    netAssets: 5e8,
    currentAssets: 3e8,
    currentLiabilities: 1e8,
    ...overrides,
  };
}

const confirmedNormal: HumanConfirmedFacts = {
  hasFinancialStatement: true,
  standaloneOrOperatingReportOnly: false,
  missingStatementReason: null,
};

describe("revenueSizeScore：营收体量得分表", () => {
  it.each([
    [6e8, 100],
    [5e8, 100],
    [4e8, 90],
    [3e8, 90],
    [2e8, 72],
    [1e8, 72],
    [8e7, 52],
    [5e7, 52],
    [3e7, 30],
    [1e7, 30],
    [5e6, 0],
    [0, 0],
  ])("revenue=%d → %d", (revenue, expected) => {
    expect(revenueSizeScore(revenue)).toBe(expected);
  });

  it("缺失营收返回 null，不当 0 处理", () => {
    expect(revenueSizeScore(null)).toBeNull();
  });
});

describe("profitLevelScore：绝对盈利水平得分表", () => {
  it.each([
    [2e8, 100],
    [8e7, 90],
    [3e7, 82],
    [1.5e7, 75],
    [7e6, 65],
    [3e6, 55],
    [5e5, 45],
    [0, 45],
  ])("netProfit=%d → %d", (netProfit, expected) => {
    expect(profitLevelScore(netProfit)).toBe(expected);
  });

  it("亏损分档随亏损扩大而降低（越亏越低，区间内单调）", () => {
    const smallLoss = profitLevelScore(-1e6)!;
    const midLoss = profitLevelScore(-5e7)!;
    const bigLoss = profitLevelScore(-2e8)!;
    expect(smallLoss).toBeLessThan(0);
    expect(smallLoss).toBeGreaterThan(midLoss);
    expect(midLoss).toBeGreaterThan(bigLoss);
    expect(bigLoss).toBe(-70);
  });
});

describe("revenueGrowthScore：营收增长率得分（对数压缩）", () => {
  it("+50% 增长（本年/上年=1.5）→ 90 分（PDF 示例）", () => {
    expect(revenueGrowthScore(1.5e8, 1e8)).toBeCloseTo(90, 6);
  });

  it("下滑到上年/本年=1.3 → -35 分（PDF 公式定义点）", () => {
    expect(revenueGrowthScore(1e8, 1.3e8)).toBeCloseTo(-35, 6);
  });

  it("无上年数据 → 按体量给分（等于营收体量得分）", () => {
    expect(revenueGrowthScore(4e8, null)).toBe(revenueSizeScore(4e8));
  });

  it("上年为 0 或负数：无法取对数，返回 null 交给数据质量层处理", () => {
    expect(revenueGrowthScore(1e8, 0)).toBeNull();
    expect(revenueGrowthScore(1e8, -1e7)).toBeNull();
  });
});

describe("profitGrowthScore：净利润增长率得分（六种情形）", () => {
  it("扭亏为盈：亏损越大，得分越高（70~90 区间）", () => {
    const smallTurn = profitGrowthScore(1e6, -1e6)!;
    const bigTurn = profitGrowthScore(1e6, -1.2e8)!;
    expect(smallTurn).toBeGreaterThanOrEqual(70);
    expect(smallTurn).toBeLessThan(bigTurn);
    expect(bigTurn).toBeLessThanOrEqual(90);
  });

  it("连续亏损收窄：收窄比例映射到 0~100", () => {
    // 亏损从 1000 万收窄到 500 万，收窄 50%
    expect(profitGrowthScore(-5e6, -1e7)).toBeCloseTo(50, 6);
  });

  it("连续亏损扩大：负分", () => {
    expect(profitGrowthScore(-2e7, -1e7)!).toBeLessThan(0);
  });

  it("连续盈利增长：80 × log2(本年/上年)，翻倍 → 80 分", () => {
    expect(profitGrowthScore(2e7, 1e7)).toBeCloseTo(80, 6);
  });

  it("连续盈利下滑：温和惩罚，最多 -25", () => {
    const score = profitGrowthScore(5e6, 1e7)!;
    expect(score).toBeLessThan(0);
    expect(score).toBeGreaterThanOrEqual(-25);
  });

  it("由盈转亏：-70", () => {
    expect(profitGrowthScore(-1e6, 1e6)).toBe(-70);
  });

  it("无上年数据：盈利 +40 / 亏损 -20", () => {
    expect(profitGrowthScore(1e6, null)).toBe(40);
    expect(profitGrowthScore(-1e6, null)).toBe(-20);
  });
});

describe("cashScore：现金自给月数分段线性", () => {
  it.each([
    [30, 100],
    [24, 100],
    [18, 75], // 12-24 线性中点 → 50~100 中点 75
    [12, 50],
    [9, 25], // 6-12 线性中点 → 0~50 中点 25
    [6, 0],
    [4.5, -15], // 3-6 线性中点 → -30~0 中点 -15
    [3, -30],
    [2, -45], // 1-3 线性中点 → -60~-30 中点 -45
    [1, -60],
    [0.65, -70], // 0.3-1 线性中点 → -80~-60 中点 -70
    [0.3, -80],
    [0.1, -85],
    [0, -85],
  ])("months=%d → %d", (months, expected) => {
    expect(cashScore(months)).toBeCloseTo(expected, 6);
  });

  it("经营现金流出为 0（无法计算月均流出）→ null", () => {
    expect(computeS3(baseInput({ operatingCashOutflow12m: 0 })).s3).toBeNull();
  });
});

describe("computeS1/S2/S3：加权组合", () => {
  it("S1 = 增长率得分×40% + 体量得分×60%", () => {
    const input = baseInput({ revenue: 6e8, revenuePriorYear: 4e8 });
    const { s1, sizeScore, growthScore } = computeS1(input);
    expect(s1).toBeCloseTo(growthScore! * 0.4 + sizeScore! * 0.6, 6);
  });

  it("S2 = 净利润增长率得分×40% + 绝对盈利水平得分×60%", () => {
    const input = baseInput({ netProfit: 8e7, netProfitPriorYear: 5e7 });
    const { s2, levelScore, growthScore } = computeS2(input);
    expect(s2).toBeCloseTo(growthScore! * 0.4 + levelScore! * 0.6, 6);
  });

  it("任一子项缺失 → 该维度整体为 null（不拿 0 顶替）", () => {
    expect(computeS1(baseInput({ revenue: null })).s1).toBeNull();
    expect(computeS2(baseInput({ netProfit: null })).s2).toBeNull();
    expect(computeS3(baseInput({ cashAndEquivalents: null })).s3).toBeNull();
  });
});

describe("gradeFromTotal：总分 → A-E 分级表", () => {
  it.each([
    [141, "A"],
    [140.001, "A"],
    [140, "B"],
    [100.001, "B"],
    [100, "C"],
    [70.001, "C"],
    [70, "D"],
    [40.001, "D"],
    [40, "E"],
    [-50, "E"],
  ])("total=%d → %s", (total, expected) => {
    expect(gradeFromTotal(total)).toBe(expected);
  });
});

describe("suspectedAbnormalFlag：数据疑似异常两条比率规则", () => {
  it("(应收+存货)/收入 > 80% → true", () => {
    const input = baseInput({ revenue: 1e8, accountsReceivable: 5e7, inventory: 4e7 });
    expect(suspectedAbnormalFlag(input)).toBe(true);
  });

  it("(应收+存货)/收入 <= 80% → false（同基线不触发）", () => {
    expect(suspectedAbnormalFlag(baseInput())).toBe(false);
  });

  it("其他应收款/总资产 > 20% → true", () => {
    const input = baseInput({ totalAssets: 1e8, otherReceivables: 3e7 });
    expect(suspectedAbnormalFlag(input)).toBe(true);
  });

  it("其他应收款同比增长 > 50% 且经营现金流为负 → true", () => {
    const input = baseInput({
      totalAssets: 1e9,
      otherReceivables: 2e7,
      otherReceivablesPriorYear: 1e7,
      operatingCashFlowNet: -1e6,
    });
    expect(suspectedAbnormalFlag(input)).toBe(true);
  });

  it("其他应收款同比增长 > 50% 但经营现金流为正 → false", () => {
    const input = baseInput({
      totalAssets: 1e9,
      otherReceivables: 2e7,
      otherReceivablesPriorYear: 1e7,
      operatingCashFlowNet: 1e6,
    });
    expect(suspectedAbnormalFlag(input)).toBe(false);
  });
});

describe("downgradeTrigger：两条直接降级触发条件", () => {
  it("资不抵债（净资产<0）→ D", () => {
    expect(downgradeTrigger(baseInput({ netAssets: -1 }))).toBe("D");
  });

  it("资不抵债 + 经营现金流为负 + 流动比率<1 → E", () => {
    const input = baseInput({
      netAssets: -1,
      operatingCashFlowNet: -1,
      currentAssets: 5e7,
      currentLiabilities: 1e8,
    });
    expect(downgradeTrigger(input)).toBe("E");
  });

  it("资不抵债但经营现金流为正 → 仍只降到 D，不降到 E", () => {
    const input = baseInput({
      netAssets: -1,
      operatingCashFlowNet: 1e6,
      currentAssets: 5e7,
      currentLiabilities: 1e8,
    });
    expect(downgradeTrigger(input)).toBe("D");
  });

  it("净资产非负 → 无降级", () => {
    expect(downgradeTrigger(baseInput({ netAssets: 1 }))).toBeNull();
  });

  it("净资产缺失 → 无降级判定（null，不假设资不抵债）", () => {
    expect(downgradeTrigger(baseInput({ netAssets: null }))).toBeNull();
  });
});

describe("rate：端到端整体评级", () => {
  it("同一输入两次运行得分逐位一致（R7 业务规则 2：确定性）", () => {
    const input = baseInput();
    const r1 = rate(input);
    const r2 = rate(input);
    expect(r1).toStrictEqual(r2);
  });

  it("优秀项目（高营收高利润高现金）→ A 级", () => {
    const input = baseInput({
      revenue: 8e8,
      revenuePriorYear: 5e8,
      netProfit: 1.2e8,
      netProfitPriorYear: 6e7,
      cashAndEquivalents: 5e8,
      operatingCashOutflow12m: 1e8,
    });
    const result = rate(input);
    expect(result.grade).toBe("A");
    expect(result.scores.total).not.toBeNull();
  });

  it("资不抵债的项目即使算分较高也被降到 D", () => {
    const input = baseInput({ netAssets: -1e6 });
    const result = rate(input);
    expect(result.downgrade).toBe("D");
    expect(["D", "E"]).toContain(result.grade);
  });

  it("关键指标缺失 → grade 为 null 且给出原因，不用心算补一个分数", () => {
    const result = rate(baseInput({ revenue: null }));
    expect(result.grade).toBeNull();
    expect(result.cannotRateReason).not.toBeNull();
  });
});

describe("rateWithDataQuality：数据质量分支入口", () => {
  it("无财务报表 + 异常原因（失联）→ 直接 E + business_abnormal 标注", () => {
    const facts: HumanConfirmedFacts = {
      hasFinancialStatement: false,
      standaloneOrOperatingReportOnly: false,
      missingStatementReason: "lost_contact",
    };
    const result = rateWithDataQuality(baseInput(), facts);
    expect(result.grade).toBe("E");
    expect(result.flags).toContain("business_abnormal");
  });

  it("无财务报表 + 正常原因（保密期）→ 不出分、给出需要往期数据的说明", () => {
    const facts: HumanConfirmedFacts = {
      hasFinancialStatement: false,
      standaloneOrOperatingReportOnly: false,
      missingStatementReason: "confidentiality_period",
    };
    const result = rateWithDataQuality(baseInput(), facts);
    expect(result.grade).toBeNull();
    expect(result.cannotRateReason).not.toBeNull();
  });

  it("仅单体报表/仅经营报告 → 正常出分 + incomplete 标注", () => {
    const facts: HumanConfirmedFacts = {
      ...confirmedNormal,
      standaloneOrOperatingReportOnly: true,
    };
    const result = rateWithDataQuality(baseInput(), facts);
    expect(result.grade).not.toBeNull();
    expect(result.flags).toContain("incomplete");
  });

  it("正常数据 → 出分且无异常标注", () => {
    const result = rateWithDataQuality(baseInput(), confirmedNormal);
    expect(result.grade).not.toBeNull();
    expect(result.flags).toHaveLength(0);
  });

  it("疑似异常数据同时命中 → suspected_abnormal 标注但仍正常出分（不因此降级）", () => {
    const input = baseInput({ revenue: 1e8, accountsReceivable: 5e7, inventory: 4e7 });
    const result = rateWithDataQuality(input, confirmedNormal);
    expect(result.grade).not.toBeNull();
    expect(result.flags).toContain("suspected_abnormal");
  });
});
