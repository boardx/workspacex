/**
 * 派生数值的**参照实现** —— 六个公式的确定性计算，以及按阈值判风险。
 *
 * ## 为什么它存在（而模型那边也要算一遍）
 *
 * 真实链路里派生数值由模型在 `data-analysis` skill 的沙箱里算（方法论正文要求它这么
 * 做，理由是同一份材料重复分析必须给出同一个数字，模型心算做不到这一点）。这份实现
 * 是那套公式的**参照与回归防护网**：公式写在这里、被真实数字的单测钉住，方法论正文
 * 里给模型的公式文字由 `@repo/contracts` 的 `renderDerivedFormulas()` 渲染——三者同源。
 * 没有它，"公式改了"这件事在仓库里没有任何东西会红。
 *
 * ⚠ 阈值与公式文字的单一事实源是 `packages/contracts/src/post-investment-rules.ts`，
 * 本文件 import 它，不在这里重新声明数字（ADR-020；本仓已因"同一事实声明在两处"
 * 漂移过五次）。
 */
import {
  CAPITALIZATION_INDUSTRY_RANGE,
  MILESTONE_DELAY,
  RELATED_PARTY_PRICE_GAP,
  REVENUE_PROFIT_GROWTH_GAP,
  SUBSIDY_PROFIT_SHARE,
  TOP1_CUSTOMER_SHARE,
  TOP5_CUSTOMER_SHARE,
} from "@repo/contracts/post-investment-rules";

/**
 * 从材料原文里常见的数字写法（"4,680万元" / "-860万元" / "29.5%"）里抽出一个可比较的
 * 浮点数。抽不出来返回 `null`——**不猜**，调用方据此把派生值置空而不是编一个数字。
 */
export function parseNumericValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** 四舍五入到一位小数——所有百分比结果统一口径，避免"同一材料两次跑出 18.18 和 18.2"。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ── 六个派生公式（与 contracts 的 `DERIVED_FORMULAS` 一一对应）───────── */

/** 同比/环比百分比。任一侧解析不出数字，或基期为 0（除零），返回 `null`。 */
export function computeYoyPct(currentValue: string | number, priorValue: string | number | null): number | null {
  if (priorValue === null) return null;
  const current = typeof currentValue === "number" ? currentValue : parseNumericValue(currentValue);
  const prior = typeof priorValue === "number" ? priorValue : parseNumericValue(priorValue);
  if (current === null || prior === null || prior === 0) return null;
  return round1(((current - prior) / Math.abs(prior)) * 100);
}

/** 研发资本化率 = 资本化金额 / 研发支出总额。 */
export function capitalizationRate(capitalized: number, totalRnD: number): number | null {
  if (!Number.isFinite(capitalized) || !Number.isFinite(totalRnD) || totalRnD === 0) return null;
  return round1((capitalized / totalRnD) * 100);
}

/** 客户集中度 = 该客户（或前 N 大合计）销售额 / 营业收入。 */
export function concentrationRatio(customerSales: number, revenue: number): number | null {
  if (!Number.isFinite(customerSales) || !Number.isFinite(revenue) || revenue === 0) return null;
  return round1((customerSales / revenue) * 100);
}

/** 关联方价差率 = (第三方均价 − 关联方均价) / 第三方均价。正值 = 关联方更便宜。 */
export function relatedPartyPriceGapPct(relatedPrice: number, thirdPartyPrice: number): number | null {
  if (!Number.isFinite(relatedPrice) || !Number.isFinite(thirdPartyPrice) || thirdPartyPrice === 0) return null;
  return round1(((thirdPartyPrice - relatedPrice) / thirdPartyPrice) * 100);
}

/** 现金跑道月数 = 货币资金 / 月均经营净流出。净流出非正 ⇒ null（没有"烧钱速度"可言）。 */
export function cashRunwayMonths(cash: number, monthlyNetOutflow: number): number | null {
  if (!Number.isFinite(cash) || !Number.isFinite(monthlyNetOutflow) || monthlyNetOutflow <= 0) return null;
  return round1(cash / monthlyNetOutflow);
}

/** 缺口月数 = 里程碑所需月数 − 现金跑道月数。为正即资金缺口。 */
export function runwayGapMonths(milestoneMonths: number, runwayMonths: number | null): number | null {
  if (runwayMonths === null || !Number.isFinite(milestoneMonths)) return null;
  return round1(milestoneMonths - runwayMonths);
}

/* ── 按阈值判风险（阈值全部来自 contracts，不在这里写第二份数字）──────── */

/** A-R01：增收不增利。 */
export function isRevenueProfitDivergent(revenueYoyPct: number | null, profitYoyPct: number | null): boolean {
  if (revenueYoyPct === null || profitYoyPct === null) return false;
  if (revenueYoyPct > 0 && profitYoyPct < 0) return true;
  return revenueYoyPct - profitYoyPct > REVENUE_PROFIT_GROWTH_GAP.value;
}

/** A-R03：资本化率偏离行业区间。 */
export function isCapitalizationAbnormal(ratePct: number | null): boolean {
  if (ratePct === null) return false;
  return ratePct > CAPITALIZATION_INDUSTRY_RANGE.high || ratePct < CAPITALIZATION_INDUSTRY_RANGE.low;
}

/** B-R03：关联方定价存疑。 */
export function isRelatedPartyPriceSuspect(gapPct: number | null): boolean {
  return gapPct !== null && Math.abs(gapPct) > RELATED_PARTY_PRICE_GAP.value;
}

/** B-R05：补助依赖。 */
export function isSubsidyDependent(subsidy: number, totalProfit: number): boolean {
  if (!Number.isFinite(subsidy) || !Number.isFinite(totalProfit) || totalProfit === 0) return false;
  return (subsidy / totalProfit) * 100 > SUBSIDY_PROFIT_SHARE.value;
}

/** B-R01：客户集中度过高（第一大或前五大任一越线）。 */
export function isCustomerConcentrationHigh(top1Pct: number | null, top5Pct: number | null): boolean {
  return (top1Pct !== null && top1Pct > TOP1_CUSTOMER_SHARE.value)
    || (top5Pct !== null && top5Pct > TOP5_CUSTOMER_SHARE.value);
}

/** C-R01：里程碑滞后（完成率低于计划 `MILESTONE_DELAY.value`% 以上）。 */
export function isMilestoneDelayed(actual: number, planned: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(planned) || planned === 0) return false;
  const completionPct = (actual / planned) * 100;
  return 100 - completionPct > MILESTONE_DELAY.value;
}
