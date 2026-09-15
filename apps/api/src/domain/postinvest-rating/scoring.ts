/**
 * 投后财务项目评级 Agent — 确定性评分引擎（ad-hoc MVP，issue 见 PR 描述）。
 *
 * 唯一事实源：本文件的阈值/公式逐字对齐人类提供的
 * 《投后财务项目评级 Agent — 大模型测试方案与模拟测试文件》v1.0（2026-09-15）。
 * 不在别处复述这些数值（UI/契约/文档只引用，不复制）。
 *
 * 纯函数，无副作用、无 I/O：同一输入必然得到位级相同的输出（R7 业务规则 2）。
 * 缺失字段一律为 `null`，绝不当作 0 参与计算（R7 业务规则 3）。
 *
 * 类型命名加了 `Scoring` 前缀（`ScoringGrade`/`ScoringDataQualityFlag`/`ScoringBreakdown`），
 * 刻意与 `packages/contracts/src/postinvest-rating.ts`（未签核契约束，`RatingGrade`/
 * `DataQualityFlag`/`ScoreBreakdown`）同名但不同名字撞上——`lint-contract-source.mjs`
 * 按类型名逐字匹配，撞名即判「同一事实两处声明」（ADR-020）。两者确实是不同的事实：
 * 本文件是 MVP 直收已抽取字段的计算引擎，那份契约是文件上传+agent 编排完整形态签核
 * 后的 API 面；在契约未签核前 import 它会把 MVP 绑死在一个还可能改的形状上。
 */

export type Nullable<T> = T | null;

/** 一次评级的最小财务输入（MVP 范围：只接受已抽取好的结构化字段，不做文档解析）。 */
export interface FinancialInput {
  /** 本年营业收入（元） */
  revenue: Nullable<number>;
  /** 上年营业收入（元），无上年数据传 null */
  revenuePriorYear: Nullable<number>;
  /** 本年净利润（元），可为负 */
  netProfit: Nullable<number>;
  /** 上年净利润（元），无上年数据传 null */
  netProfitPriorYear: Nullable<number>;
  /** 货币资金（元） */
  cashAndEquivalents: Nullable<number>;
  /** 近 12 月经营活动现金流出合计（元） */
  operatingCashOutflow12m: Nullable<number>;
  /** 经营活动产生的现金流量净额（元），用于数据疑似异常判定与降级触发 */
  operatingCashFlowNet: Nullable<number>;
  /** 应收账款（元） */
  accountsReceivable: Nullable<number>;
  /** 存货（元） */
  inventory: Nullable<number>;
  /** 其他应收款（元），本年 */
  otherReceivables: Nullable<number>;
  /** 其他应收款（元），上年 */
  otherReceivablesPriorYear: Nullable<number>;
  /** 总资产（元） */
  totalAssets: Nullable<number>;
  /** 净资产（元），用于降级触发（资不抵债） */
  netAssets: Nullable<number>;
  /** 流动资产（元） */
  currentAssets: Nullable<number>;
  /** 流动负债（元） */
  currentLiabilities: Nullable<number>;
}

/** 人工确认的数据缺失事实（R7 业务规则 5：Agent 不得自行推断）。 */
export interface HumanConfirmedFacts {
  /** 有审计报告或财务报表 */
  hasFinancialStatement: boolean;
  /** 仅有未合并子公司单体报表，或仅有经营报告 */
  standaloneOrOperatingReportOnly: boolean;
  /** 无财务报表的原因；hasFinancialStatement=false 时必填 */
  missingStatementReason: Nullable<
    "confidentiality_period" | "relationship_broken" | "major_litigation" | "lost_contact" | "suspended" | "bankrupt"
  >;
}

export type ScoringDataQualityFlag = "incomplete" | "estimated" | "business_abnormal" | "suspected_abnormal";

export type ScoringGrade = "A" | "B" | "C" | "D" | "E";

export interface ScoringBreakdown {
  revenueSizeScore: Nullable<number>;
  revenueGrowthScore: Nullable<number>;
  s1: Nullable<number>;
  profitLevelScore: Nullable<number>;
  profitGrowthScore: Nullable<number>;
  s2: Nullable<number>;
  cashSelfSufficiencyMonths: Nullable<number>;
  s3: Nullable<number>;
  total: Nullable<number>;
}

export interface RatingResult {
  grade: Nullable<ScoringGrade>;
  scores: ScoringBreakdown;
  flags: ScoringDataQualityFlag[];
  downgrade: Nullable<"D" | "E">;
  /** 无法评级时的说明（MVP：只覆盖"无财务报表"这一条 R4 A1） */
  cannotRateReason: Nullable<string>;
}

const REASON_IS_ABNORMAL = (
  reason: HumanConfirmedFacts["missingStatementReason"]
): boolean => reason === "major_litigation" || reason === "lost_contact" || reason === "suspended" || reason === "bankrupt";

/** 营业收入体量得分（反映绝对规模）。单位：元。 */
export function revenueSizeScore(revenue: Nullable<number>): Nullable<number> {
  if (revenue === null) return null;
  if (revenue >= 5e8) return 100;
  if (revenue >= 3e8) return 90;
  if (revenue >= 1e8) return 72;
  if (revenue >= 5e7) return 52;
  if (revenue >= 1e7) return 30;
  return 0;
}

/** 净利润绝对盈利水平得分。单位：元。 */
export function profitLevelScore(netProfit: Nullable<number>): Nullable<number> {
  if (netProfit === null) return null;
  if (netProfit >= 1e8) return 100;
  if (netProfit >= 5e7) return 90;
  if (netProfit >= 2e7) return 82;
  if (netProfit >= 1e7) return 75;
  if (netProfit >= 5e6) return 65;
  if (netProfit >= 1e6) return 55;
  if (netProfit >= 0) return 45;
  // 亏损分档：越接近 0 越接近区间上沿（-5/-15/-30/-70 为该档的边界锚点）
  const loss = -netProfit;
  if (loss <= 1e7) return -5 - (loss / 1e7) * 10; // -5 ~ -15
  if (loss <= 1e8) return -15 - ((loss - 1e7) / (1e8 - 1e7)) * 15; // -15 ~ -30
  return -70;
}

/** 营收增长率得分：对数压缩，平滑极端值。 */
export function revenueGrowthScore(revenue: Nullable<number>, revenuePriorYear: Nullable<number>): Nullable<number> {
  if (revenuePriorYear === null) return revenueSizeScore(revenue); // 无上年数据：按体量给分，中性偏正
  if (revenue === null) return null;
  if (revenuePriorYear <= 0 || revenue <= 0) return null; // 非正数无法取对数，交给数据质量标注处理
  if (revenue >= revenuePriorYear) return 90 * Math.log(revenue / revenuePriorYear) / Math.log(1.5);
  return -35 * (Math.log(revenuePriorYear / revenue) / Math.log(1.3));
}

/** 净利润增长率得分。六种情形 + 无上年数据。 */
export function profitGrowthScore(netProfit: Nullable<number>, netProfitPriorYear: Nullable<number>): Nullable<number> {
  if (netProfit === null) return null;
  if (netProfitPriorYear === null) return netProfit >= 0 ? 40 : -20; // 无上年数据：盈利+40 / 亏损-20
  const wasLoss = netProfitPriorYear < 0;
  const isLoss = netProfit < 0;

  if (wasLoss && !isLoss) {
    // 扭亏为盈：亏损越大越高，70~90（以上年亏损 1 亿封顶映射）
    const priorLoss = Math.min(-netProfitPriorYear, 1e8);
    return 70 + (priorLoss / 1e8) * 20;
  }
  if (wasLoss && isLoss) {
    const priorLoss = -netProfitPriorYear;
    const curLoss = -netProfit;
    if (priorLoss <= 0) return null;
    if (curLoss < priorLoss) {
      // 收窄：收窄比例映射到 0~100
      const narrowedRatio = (priorLoss - curLoss) / priorLoss;
      return narrowedRatio * 100;
    }
    // 扩大：负分，按扩大比例给负分（无上限表，取扩大比例的负值，封顶 -100）
    const widenedRatio = (curLoss - priorLoss) / priorLoss;
    return Math.max(-widenedRatio * 100, -100);
  }
  if (!wasLoss && isLoss) return -70; // 由盈转亏
  // 连续盈利
  if (netProfit >= netProfitPriorYear) {
    if (netProfitPriorYear <= 0) return 40; // 上年利润为 0 时对数无意义，按扭亏边界处理
    return 80 * (Math.log(netProfit / netProfitPriorYear) / Math.log(2));
  }
  // 连续盈利但下滑：温和惩罚，最多 -25
  if (netProfitPriorYear <= 0) return -25;
  const declineRatio = (netProfitPriorYear - netProfit) / netProfitPriorYear;
  return -Math.min(declineRatio * 25, 25);
}

/** 现金自给月数 = 货币资金 ÷ (近12月经营现金流出 ÷ 12)。 */
export function cashSelfSufficiencyMonths(
  cash: Nullable<number>,
  operatingCashOutflow12m: Nullable<number>
): Nullable<number> {
  if (cash === null || operatingCashOutflow12m === null) return null;
  if (operatingCashOutflow12m <= 0) return null; // 无法计算月均流出，交给数据质量标注
  return cash / (operatingCashOutflow12m / 12);
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/** 现金自给月数 → S3 得分，分段线性 + 两端常数。 */
export function cashScore(months: Nullable<number>): Nullable<number> {
  if (months === null) return null;
  if (months >= 24) return 100;
  if (months >= 12) return lerp(months, 12, 24, 50, 100);
  if (months >= 6) return lerp(months, 6, 12, 0, 50);
  if (months >= 3) return lerp(months, 3, 6, -30, 0);
  if (months >= 1) return lerp(months, 1, 3, -60, -30);
  if (months >= 0.3) return lerp(months, 0.3, 1, -80, -60);
  return -85;
}

export function computeS1(input: FinancialInput): { s1: Nullable<number>; sizeScore: Nullable<number>; growthScore: Nullable<number> } {
  const sizeScore = revenueSizeScore(input.revenue);
  const growthScore = revenueGrowthScore(input.revenue, input.revenuePriorYear);
  if (sizeScore === null || growthScore === null) return { s1: null, sizeScore, growthScore };
  return { s1: growthScore * 0.4 + sizeScore * 0.6, sizeScore, growthScore };
}

export function computeS2(input: FinancialInput): { s2: Nullable<number>; levelScore: Nullable<number>; growthScore: Nullable<number> } {
  const levelScore = profitLevelScore(input.netProfit);
  const growthScore = profitGrowthScore(input.netProfit, input.netProfitPriorYear);
  if (levelScore === null || growthScore === null) return { s2: null, levelScore, growthScore };
  return { s2: growthScore * 0.4 + levelScore * 0.6, levelScore, growthScore };
}

export function computeS3(input: FinancialInput): { s3: Nullable<number>; months: Nullable<number> } {
  const months = cashSelfSufficiencyMonths(input.cashAndEquivalents, input.operatingCashOutflow12m);
  return { s3: cashScore(months), months };
}

/** 总分 → 等级（不考虑降级触发）。 */
export function gradeFromTotal(total: number): ScoringGrade {
  if (total > 140) return "A";
  if (total > 100) return "B";
  if (total > 70) return "C";
  if (total > 40) return "D";
  return "E";
}

/** 数据质量标注：应收+存货占收入比 / 其他应收款占总资产比或同比增长叠加经营现金流为负。 */
export function suspectedAbnormalFlag(input: FinancialInput): boolean {
  const { revenue, accountsReceivable, inventory, otherReceivables, otherReceivablesPriorYear, totalAssets, operatingCashFlowNet } = input;

  if (revenue !== null && revenue > 0 && accountsReceivable !== null && inventory !== null) {
    if ((accountsReceivable + inventory) / revenue > 0.8) return true;
  }
  if (totalAssets !== null && totalAssets > 0 && otherReceivables !== null) {
    if (otherReceivables / totalAssets > 0.2) return true;
    if (
      otherReceivablesPriorYear !== null &&
      otherReceivablesPriorYear > 0 &&
      operatingCashFlowNet !== null &&
      operatingCashFlowNet < 0
    ) {
      if ((otherReceivables - otherReceivablesPriorYear) / otherReceivablesPriorYear > 0.5) return true;
    }
  }
  return false;
}

/** 降级触发：资不抵债 → D；资不抵债 + 经营现金流为负 + 流动比率<1 → E。 */
export function downgradeTrigger(input: FinancialInput): Nullable<"D" | "E"> {
  if (input.netAssets === null) return null;
  if (input.netAssets >= 0) return null;
  if (
    input.operatingCashFlowNet !== null &&
    input.operatingCashFlowNet < 0 &&
    input.currentAssets !== null &&
    input.currentLiabilities !== null &&
    input.currentLiabilities > 0 &&
    input.currentAssets / input.currentLiabilities < 1
  ) {
    return "E";
  }
  return "D";
}

/**
 * 对一份已抽取字段的财务输入完整评级（MVP：假设已通过人工确认排除"无财务报表"分支，
 * 或调用方已在此之前处理该分支——见 `rateWithDataQuality`）。
 */
export function rate(input: FinancialInput): RatingResult {
  const s1r = computeS1(input);
  const s2r = computeS2(input);
  const s3r = computeS3(input);

  const flags: ScoringDataQualityFlag[] = [];
  if (suspectedAbnormalFlag(input)) flags.push("suspected_abnormal");

  const scores: ScoringBreakdown = {
    revenueSizeScore: s1r.sizeScore,
    revenueGrowthScore: s1r.growthScore,
    s1: s1r.s1,
    profitLevelScore: s2r.levelScore,
    profitGrowthScore: s2r.growthScore,
    s2: s2r.s2,
    cashSelfSufficiencyMonths: s3r.months,
    s3: s3r.s3,
    total: null,
  };

  if (s1r.s1 === null || s2r.s2 === null || s3r.s3 === null) {
    return { grade: null, scores, flags, downgrade: null, cannotRateReason: "关键指标缺失，无法计算总分" };
  }

  const total = 100 + s1r.s1 * 0.4 + s2r.s2 * 0.3 + s3r.s3 * 0.3;
  scores.total = total;

  let grade = gradeFromTotal(total);
  const downgrade = downgradeTrigger(input);
  if (downgrade === "D" && (grade === "A" || grade === "B" || grade === "C")) grade = "D";
  if (downgrade === "E") grade = "E";

  return { grade, scores, flags, downgrade, cannotRateReason: null };
}

/**
 * 入口：先过数据质量表（R4/R5 一、数据质量），再决定是否调用 `rate`。
 * MVP 范围：覆盖「公司经营异常→直接 E」「无财务报表(异常原因)→直接 E」两条硬分支
 * 与「数据不完整」「数据疑似异常」标注；「数据暂估」（按往期数据评定）留给
 * F01（skill 包）在有历史报表输入时实现，本函数只标注、不回填往期数据。
 */
export function rateWithDataQuality(input: FinancialInput, facts: HumanConfirmedFacts): RatingResult {
  const flags: ScoringDataQualityFlag[] = [];

  if (!facts.hasFinancialStatement) {
    if (facts.missingStatementReason !== null && REASON_IS_ABNORMAL(facts.missingStatementReason)) {
      return {
        grade: "E",
        scores: {
          revenueSizeScore: null,
          revenueGrowthScore: null,
          s1: null,
          profitLevelScore: null,
          profitGrowthScore: null,
          s2: null,
          cashSelfSufficiencyMonths: null,
          s3: null,
          total: null,
        },
        flags: ["business_abnormal"],
        downgrade: null,
        cannotRateReason: null,
      };
    }
    return {
      grade: null,
      scores: {
        revenueSizeScore: null,
        revenueGrowthScore: null,
        s1: null,
        profitLevelScore: null,
        profitGrowthScore: null,
        s2: null,
        cashSelfSufficiencyMonths: null,
        s3: null,
        total: null,
      },
      flags: [],
      downgrade: null,
      cannotRateReason: "无财务报表：需人工提供往期报表作数据暂估依据，或补充说明缺失原因（本 MVP 不自动回填往期数据）",
    };
  }

  const result = rate(input);
  if (facts.standaloneOrOperatingReportOnly) flags.push("incomplete");
  result.flags = [...flags, ...result.flags];
  return result;
}
