/**
 * 投后管理报告判据手册 —— 风险阈值与派生公式的**单一事实源**（ADR-020）。
 *
 * ## 为什么必须有这一份
 *
 * 这套数值要同时出现在两个地方：写给模型看的方法论正文（模型读不到仓库源码，判据
 * 只能以文字交给它），和后端的派生数值参照实现。两份都自洽、都看着对，改了一处忘了
 * 另一处不会有任何东西变红——正是本仓已经漂移过五次的形状。同 team2
 * `postinvest-rating-rules.ts` 的做法与理由（那份是评分档位，这份是风险判据）。
 *
 * 现在两边都从这里读：`apps/api/src/application/post-investment/derive-financial-
 * metrics.ts` 按常量判定，方法论正文由 `renderRiskCriteria()` 渲染。改判据只改这一
 * 个文件。
 *
 * 数值来源：`phases/phase-17-post-investment-report-agent/requirements/
 * 03-analysis-standard-and-evidence.md` 的 C 节（该文件是判据的业务事实源，本文件是
 * 它的可执行形态）。本文件不解释判据为什么这么定，只忠实记录。
 *
 * ⚠ 纯常量与纯函数，不 import 任何东西——`packages/contracts` 被 web 与 api 两端
 * 同时 import，任何一侧的运行时依赖都会污染另一侧。
 */

/** 一条风险判据：阈值 + 渲染进方法论正文时的措辞。 */
export interface RiskThreshold {
  readonly id: string;
  readonly value: number;
  /** 单位：`pct` = 百分点（增速差这类），`ratio` = 百分比（占比这类），`month` = 月。 */
  readonly unit: "pct" | "ratio" | "month";
  /** 渲染进方法论正文的整句判据。 */
  readonly clause: string;
}

/* ── 财务类 ─────────────────────────────────────────────────────────── */

/** A-R01：营收同比为正而净利润同比为负，或两者增速差超过这个百分点数。 */
export const REVENUE_PROFIT_GROWTH_GAP = {
  id: "增收不增利", value: 20, unit: "pct",
  clause: "增收不增利：营收同比为正而净利润同比为负，或两者增速差 > 20 个百分点",
} as const satisfies RiskThreshold;

/** A-R02：利润与现金背离。没有数值阈值，方向判定即可。 */
export const PROFIT_CASH_DIVERGENCE = {
  id: "利润与现金背离", value: 0, unit: "pct",
  clause: "利润与现金背离：净利润为正而经营性现金流为负，或经营性现金流由正转负",
} as const satisfies RiskThreshold;

/** 应收异常：周转天数环比上升超过这个比例。 */
export const RECEIVABLE_TURNOVER_RISE = {
  id: "应收异常", value: 20, unit: "ratio",
  clause: "应收异常：应收账款周转天数环比上升 > 20%，或应收增幅显著高于营收增幅",
} as const satisfies RiskThreshold;

/** B-R02：存货同比增幅高出营收增幅这个百分点数，且下游需求收缩有证据却未计提跌价。 */
export const INVENTORY_REVENUE_GAP = {
  id: "存货异常", value: 20, unit: "pct",
  clause: "存货异常：存货同比增幅高出营收增幅 > 20 个百分点，且材料中已有下游需求收缩证据（政策退坡/销量增速放缓）却未见存货跌价准备计提",
} as const satisfies RiskThreshold;

/** B-R03：关联方采购/销售价格与第三方价差超过这个比例且无合理解释。 */
export const RELATED_PARTY_PRICE_GAP = {
  id: "关联交易定价存疑", value: 10, unit: "ratio",
  clause: "关联交易定价存疑：关联方采购/销售价格与同期第三方价格的价差 > 10% 且材料未给出合理解释",
} as const satisfies RiskThreshold;

/** A-R03：研发资本化率落在这个区间外即偏离行业惯例（区间见 `CAPITALIZATION_INDUSTRY_RANGE`）。 */
export const CAPITALIZATION_INDUSTRY_RANGE = { low: 30, high: 50 } as const;

export const CAPITALIZATION_ABNORMAL = {
  id: "会计处理美化利润", value: CAPITALIZATION_INDUSTRY_RANGE.high, unit: "ratio",
  clause: "会计处理美化利润：研发资本化率超出行业通常的 30%-50% 区间；或折旧年限明显长于资产实际役龄；或报告期内变更收入确认政策。资本化率显著偏高时要给出「若按行业口径重算，当期利润会变成多少」的重算结论",
} as const satisfies RiskThreshold;

/** B-R05：政府补助占利润总额超过这个比例即依赖。 */
export const SUBSIDY_PROFIT_SHARE = {
  id: "补助依赖", value: 30, unit: "ratio",
  clause: "补助依赖：政府补助占利润总额 > 30%，或扣非后（利润总额减去补助）盈利能力显著弱于表观利润；叠加材料中的补助政策退坡/缩减信息时风险升级",
} as const satisfies RiskThreshold;

/** C-R02：现金跑道月数低于下一关键里程碑所需月数即缺口。 */
export const CASH_RUNWAY_SHORTFALL = {
  id: "现金跑道不足", value: 0, unit: "month",
  clause: "现金跑道不足：现金跑道月数 < 下一关键里程碑所需月数，必须给出缺口月数",
} as const satisfies RiskThreshold;

/* ── 业务类 ─────────────────────────────────────────────────────────── */

/** B-R01：第一大客户占比阈值。 */
export const TOP1_CUSTOMER_SHARE = {
  id: "客户集中度（第一大）", value: 30, unit: "ratio",
  clause: "客户集中度过高：第一大客户占营收 > 30%",
} as const satisfies RiskThreshold;

/** B-R01：前五大客户占比阈值。 */
export const TOP5_CUSTOMER_SHARE = {
  id: "客户集中度（前五大）", value: 60, unit: "ratio",
  clause: "客户集中度过高：前五大客户合计占营收 > 60%；与「核心合同即将到期未续签」或「对方持单方终止权、可无违约成本退出」叠加时按收入断崖风险处理",
} as const satisfies RiskThreshold;

/** C-R01：里程碑完成率低于计划这个比例即滞后。 */
export const MILESTONE_DELAY = {
  id: "里程碑滞后", value: 30, unit: "ratio",
  clause: "里程碑滞后：研发/临床/建设/产能的实际完成率低于计划 30% 以上，且材料未解释原因（未说明原因本身就是要单独指出的问题，不要替它找理由）",
} as const satisfies RiskThreshold;

/* ── 行业与合规类 ───────────────────────────────────────────────────── */

/** C-R05：上市后独占期低于这个月数即与商业化窗口错配。 */
export const PATENT_EXCLUSIVITY_MIN_MONTHS = {
  id: "专利与商业化窗口错配", value: 12, unit: "month",
  clause: "专利与商业化窗口错配：核心专利保护期到期日 − 预计获批日（按当前进度推算的上市时点）得到的独占期 < 12 个月",
} as const satisfies RiskThreshold;

/** 所有阈值的有序清单——渲染与遍历都用它，不在别处再列第二份。 */
export const RISK_THRESHOLDS: readonly RiskThreshold[] = [
  REVENUE_PROFIT_GROWTH_GAP,
  PROFIT_CASH_DIVERGENCE,
  RECEIVABLE_TURNOVER_RISE,
  INVENTORY_REVENUE_GAP,
  RELATED_PARTY_PRICE_GAP,
  CAPITALIZATION_ABNORMAL,
  SUBSIDY_PROFIT_SHARE,
  CASH_RUNWAY_SHORTFALL,
  TOP1_CUSTOMER_SHARE,
  TOP5_CUSTOMER_SHARE,
  MILESTONE_DELAY,
  PATENT_EXCLUSIVITY_MIN_MONTHS,
];

/* ── 派生公式（文字定义）─────────────────────────────────────────────
 * 实现在 `apps/api/src/application/post-investment/derive-financial-metrics.ts`，
 * 那边 import 本文件的常量；模型侧拿到的是下面 `clause` 渲染出来的文字。 */

export interface DerivedFormula {
  readonly id: string;
  readonly clause: string;
}

export const DERIVED_FORMULAS: readonly DerivedFormula[] = [
  { id: "同比/环比", clause: "同比/环比 = (本期 − 对比期) / |对比期| × 100%；对比期缺失或为 0 时输出 null，不推算" },
  { id: "资本化率", clause: "研发资本化率 = 资本化金额 / 研发支出总额 × 100%" },
  { id: "客户集中度", clause: "客户集中度 = 该客户（或前 N 大合计）销售额 / 营业收入 × 100%；必须与客户明细表加总核对，不符要单独报" },
  { id: "关联方价差率", clause: "关联方价差率 = (第三方均价 − 关联方均价) / 第三方均价 × 100%" },
  { id: "现金跑道月数", clause: "现金跑道月数 = 货币资金 / 月均经营净流出；月均经营净流出 = 期间经营性净流出 / 期间月数" },
  { id: "缺口月数", clause: "缺口月数 = 下一关键里程碑所需月数 − 现金跑道月数（为正即资金缺口）" },
];

/* ── 自检算例 ──────────────────────────────────────────────────────────
 * 方法论要求模型写完沙箱脚本先用几个已知算例自检。那几个数字此前硬写在方法论正文
 * 里、又出现在参照实现的测试里——两处独立、写错一处不会有任何东西红，而"方法论告诉
 * 模型的正确答案本身是错的"会让模型越改越错。现在两边都读这一份：正文由
 * `renderSelfChecks()` 渲染，参照实现的测试遍历本表用真实函数验证 `expected`。 */

export interface SelfCheckCase {
  readonly id: string;
  /** 渲染进正文的算例描述（不含期望值，期望值由 `expected` 拼上去）。 */
  readonly label: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: number;
  /** 允许的绝对误差；0 表示必须精确相等。 */
  readonly tolerance: number;
  readonly unit: "pct" | "month";
}

export const SELF_CHECK_CASES: readonly SelfCheckCase[] = [
  {
    id: "yoy", label: "营收本期 4,680 万、对比期 3,960 万，同比",
    inputs: { current: 4680, prior: 3960 }, expected: 18.2, tolerance: 0.1, unit: "pct",
  },
  {
    id: "capitalization", label: "研发支出 1,200 万、资本化 960 万，资本化率",
    inputs: { capitalized: 960, total: 1200 }, expected: 80, tolerance: 0, unit: "pct",
  },
  {
    id: "runway", label: "货币资金 4,200 万、月均经营净流出 680 万，现金跑道",
    inputs: { cash: 4200, monthlyOutflow: 680 }, expected: 6.2, tolerance: 0.1, unit: "month",
  },
];

/** 渲染成方法论正文里的自检段。 */
export function renderSelfChecks(): string {
  return SELF_CHECK_CASES.map((c) => {
    const unit = c.unit === "pct" ? "%" : " 个月";
    const tol = c.tolerance > 0 ? `（±${c.tolerance}${c.unit === "pct" ? "pct" : " 个月"}）` : "（必须精确相等）";
    return `- ${c.label}应为 ${c.expected}${unit}${tol}`;
  }).join("\n");
}

/**
 * 渲染成方法论正文里的判据段。**方法论正文不得手抄这些阈值**——它由本函数生成，
 * 改阈值只改上面的常量。
 */
export function renderRiskCriteria(): string {
  return RISK_THRESHOLDS.map((t) => `- ${t.clause}`).join("\n");
}

/** 渲染成方法论正文里的派生公式段。 */
export function renderDerivedFormulas(): string {
  return DERIVED_FORMULAS.map((f) => `- ${f.clause}`).join("\n");
}
