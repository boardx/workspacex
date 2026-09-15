/**
 * 投后评级规则手册 —— S1/S2/S3 档位表、权重、分级带、降级触发与两条"数据疑似异常"
 * 比率阈值的**单一事实源**（ADR-020）。
 *
 * ## 为什么必须有这一份
 *
 * 这套数值此前同时存在于两个地方：`apps/api/src/domain/postinvest-rating/scoring.ts`
 * 的实现，和 `apps/web/lib/postinvest-rating/rating-prompt.ts` 里写给模型看的任务书
 * （模型读不到仓库源码，公式只能以文字形式交给它）。两份都自洽、都看着对，改了一处
 * 忘了另一处不会有任何东西变红——正是本仓已经漂移过五次的形状。
 *
 * 现在两边都从这里读：`scoring.ts` 按表计算，任务书由 `renderRuleBook()` 渲染。
 * 改规则只改这一个文件。
 *
 * ## 为什么放在 contracts 而不是 skill 包
 *
 * UC-16.1 的 R7-1 规定规则最终应落在 `skills/standard-finance/postinvest-rating/`
 * 包内（D4）。那个包属于 F01，尚未建。在它建起来之前，规则需要一个**两个 app 都能
 * import 的**位置——`packages/contracts` 是本仓既有的跨包单一事实源机制，也是
 * `postinvest-rating.ts` 契约所在。F01 落地时把本文件的常量搬进包内并让这里改为引用，
 * 那是一次搬家，不是再抄一份。
 *
 * 数值来源：《投后财务项目评级 Agent — 大模型测试方案与模拟测试文件》v1.0（人类提供的
 * PDF，权威原文）。本文件不解释规则为什么这么定，只忠实记录。
 */

/** 单位统一为元。1e8 = 1 亿。 */
export interface ScoreBand {
  /** 下沿（含）。按 `bands` 数组从高到低依次匹配第一个 `value >= min` 的档。 */
  readonly min: number;
  readonly score: number;
  /** 渲染进任务书时用的档位说明，如 "≥5亿"。 */
  readonly label: string;
}

/** 营收体量得分（S1 的 60%）。 */
export const REVENUE_SIZE_BANDS: readonly ScoreBand[] = [
  { min: 5e8, score: 100, label: "≥5亿" },
  { min: 3e8, score: 90, label: "3-5亿" },
  { min: 1e8, score: 72, label: "1-3亿" },
  { min: 5e7, score: 52, label: "5000万-1亿" },
  { min: 1e7, score: 30, label: "1000万-5000万" },
  { min: Number.NEGATIVE_INFINITY, score: 0, label: "<1000万" },
];

/** 绝对盈利水平得分的**盈利段**（S2 的 60%）；亏损段是线性插值，见 `PROFIT_LOSS_ANCHORS`。 */
export const PROFIT_LEVEL_BANDS: readonly ScoreBand[] = [
  { min: 1e8, score: 100, label: "≥1亿" },
  { min: 5e7, score: 90, label: "5000万-1亿" },
  { min: 2e7, score: 82, label: "2000万-5000万" },
  { min: 1e7, score: 75, label: "1000万-2000万" },
  { min: 5e6, score: 65, label: "500万-1000万" },
  { min: 1e6, score: 55, label: "100万-500万" },
  { min: 0, score: 45, label: "0-100万" },
];

/** 亏损段锚点：亏损额在 [lossFrom, lossTo] 内时得分自 `from` 线性降到 `to`。 */
export const PROFIT_LOSS_ANCHORS = {
  /** 亏损 0 ~ 1000万 → -5 ~ -15 */
  mild: { lossFrom: 0, lossTo: 1e7, from: -5, to: -15, label: "亏损1000万以内→-5~-15（线性，越亏越低）" },
  /** 亏损 1000万 ~ 1亿 → -15 ~ -30 */
  heavy: { lossFrom: 1e7, lossTo: 1e8, from: -15, to: -30, label: "亏损1000万-1亿→-15~-30（线性）" },
  /** 亏损 ≥1亿 */
  severe: { score: -70, label: "亏损≥1亿→-70" },
} as const;

/** 现金自给月数 → S3 得分。分段线性 + 两端常数。 */
export interface CashBand {
  readonly monthsFrom: number;
  readonly monthsTo: number;
  readonly scoreFrom: number;
  readonly scoreTo: number;
  readonly label: string;
}
export const CASH_MONTH_TOP = { months: 24, score: 100, label: "≥24月→100" } as const;
export const CASH_MONTH_FLOOR = { months: 0.3, score: -85, label: "<0.3月→-85" } as const;
export const CASH_MONTH_BANDS: readonly CashBand[] = [
  { monthsFrom: 12, monthsTo: 24, scoreFrom: 50, scoreTo: 100, label: "12-24月→50~100线性" },
  { monthsFrom: 6, monthsTo: 12, scoreFrom: 0, scoreTo: 50, label: "6-12月→0~50线性" },
  { monthsFrom: 3, monthsTo: 6, scoreFrom: -30, scoreTo: 0, label: "3-6月→-30~0线性" },
  { monthsFrom: 1, monthsTo: 3, scoreFrom: -60, scoreTo: -30, label: "1-3月→-60~-30线性" },
  { monthsFrom: 0.3, monthsTo: 1, scoreFrom: -80, scoreTo: -60, label: "0.3-1月→-80~-60线性" },
];

/** 增长率得分的对数底与系数。 */
export const GROWTH_COEFFICIENTS = {
  revenueUp: { coefficient: 90, logBase: 1.5 },
  revenueDown: { coefficient: -35, logBase: 1.3 },
  profitUp: { coefficient: 80, logBase: 2 },
  /** 连续盈利下滑：按下滑比例 × 25 取负，最多 -25。 */
  profitDeclineCap: 25,
  /** 扭亏为盈：按 min(上年亏损, 1亿)/1亿 线性映射到 70~90。 */
  turnaround: { from: 70, to: 90, priorLossCap: 1e8 },
  /** 由盈转亏。 */
  profitToLoss: -70,
  /** 连续亏损扩大的负分下限。 */
  wideningFloor: -100,
  /** 无上年数据时的兜底：净利润盈利 +40 / 亏损 -20（营收侧则退回体量得分）。 */
  noPriorYearProfit: 40,
  noPriorYearLoss: -20,
} as const;

/** 三个分项的权重与基准分。总分 = BASE + S1×w1 + S2×w2 + S3×w3。 */
export const SCORE_WEIGHTS = { base: 100, s1: 0.4, s2: 0.3, s3: 0.3 } as const;
/** S1/S2 各自内部的「增长 : 体量/水平」权重。 */
export const COMPONENT_SPLIT = { growth: 0.4, level: 0.6 } as const;

export interface GradeBand {
  readonly grade: "A" | "B" | "C" | "D" | "E";
  /** 下沿（不含）——`total > min` 才落进这一档。 */
  readonly min: number;
  readonly color: string;
  readonly meaning: string;
  readonly action: string;
  readonly label: string;
}

/** A–E 分级表：等级 + 颜色 + 含义 + 投后管理建议，四者逐字来自 PDF。 */
export const GRADE_BANDS: readonly GradeBand[] = [
  { grade: "A", min: 140, color: "绿", meaning: "优秀", action: "正常跟踪考虑追加投资", label: ">140" },
  { grade: "B", min: 100, color: "蓝", meaning: "正常", action: "保持跟踪优化薄弱环节", label: "100-140" },
  { grade: "C", min: 70, color: "橙", meaning: "关注", action: "关注经营变化制定改善计划", label: "70-100" },
  { grade: "D", min: 40, color: "红", meaning: "风险", action: "重点监控启动介入评估", label: "40-70" },
  { grade: "E", min: Number.NEGATIVE_INFINITY, color: "深红", meaning: "高风险", action: "启动法律程序清算/重组", label: "<40" },
];

/** 「数据疑似异常」的两条比率阈值。 */
export const SUSPECTED_ABNORMAL_THRESHOLDS = {
  /** (应收账款 + 存货) / 营业收入 */
  receivableInventoryOverRevenue: 0.8,
  /** 其他应收款 / 总资产 */
  otherReceivablesOverAssets: 0.2,
  /** 其他应收款同比增长，需叠加经营现金流为负 */
  otherReceivablesGrowth: 0.5,
} as const;

/** 两条降级触发（覆盖按总分算出的等级）。 */
export const DOWNGRADE_RULES = {
  /** 净资产 < 0 → 至多 D。 */
  insolvent: "D",
  /** 净资产 < 0 且经营现金流为负且流动比率 < 1 → 至多 E。 */
  insolventWithCashCrisis: "E",
  currentRatioThreshold: 1,
} as const;

/**
 * 把规则手册渲染成任务书里那一段（模型读不到源码，只能读文字）。
 *
 * 这是"同一事实只声明一次"的机械保证：任务书里的每一个数字都由上面的常量插值而来，
 * 不可能出现"改了实现忘了改提示词"。
 */
export function renderRuleBook(): string {
  const sizeTable = REVENUE_SIZE_BANDS.map((b) => `${b.label}→${b.score}`).join("，");
  const levelTable = [
    ...PROFIT_LEVEL_BANDS.map((b) => `${b.label}→${b.score}`),
    PROFIT_LOSS_ANCHORS.mild.label,
    PROFIT_LOSS_ANCHORS.heavy.label,
    PROFIT_LOSS_ANCHORS.severe.label,
  ].join("，");
  const cashTable = [
    CASH_MONTH_TOP.label,
    ...CASH_MONTH_BANDS.map((b) => b.label),
    CASH_MONTH_FLOOR.label,
  ].join("；");
  const gradeTable = GRADE_BANDS.map(
    (g) => `${g.label}→${g.grade}（${g.color}，${g.meaning}，${g.action}）`,
  ).join("；");
  const g = GROWTH_COEFFICIENTS;

  return [
    `S1（权重 ${SCORE_WEIGHTS.s1 * 100}%）= 增长率得分 × ${COMPONENT_SPLIT.growth * 100}% + 营收体量得分 × ${COMPONENT_SPLIT.level * 100}%`,
    `营收体量得分：${sizeTable}`,
    `增长率得分：增长 = ${g.revenueUp.coefficient} × log${g.revenueUp.logBase}(本年营收/上年营收)；` +
      `下滑 = ${g.revenueDown.coefficient} × log${g.revenueDown.logBase}(上年营收/本年营收)；`,
    "无上年数据 = 按营收体量得分（同上表）",
    "",
    `S2（权重 ${SCORE_WEIGHTS.s2 * 100}%）= 净利润增长率得分 × ${COMPONENT_SPLIT.growth * 100}% + 绝对盈利水平得分 × ${COMPONENT_SPLIT.level * 100}%`,
    `绝对盈利水平得分：${levelTable}`,
    `净利润增长率得分：扭亏为盈=${g.turnaround.from}~${g.turnaround.to}（上年亏损越大越高，按 min(上年亏损,1亿)/1亿 线性映射）；`,
    `连续亏损收窄=收窄比例×100（0~100）；连续亏损扩大=负分（按扩大比例×100，封顶${g.wideningFloor}）；`,
    `连续盈利增长=${g.profitUp.coefficient}×log${g.profitUp.logBase}(本年/上年)；连续盈利下滑=温和惩罚，最多-${g.profitDeclineCap}（按下滑比例×${g.profitDeclineCap} 取负）；`,
    `由盈转亏=${g.profitToLoss}；无上年数据：盈利+${g.noPriorYearProfit}，亏损${g.noPriorYearLoss}`,
    "",
    `S3（权重 ${SCORE_WEIGHTS.s3 * 100}%）= 现金自给月数得分`,
    "现金自给月数 = 货币资金 ÷ (近12月经营现金流出÷12)",
    `得分：${cashTable}`,
    "",
    `总分 = ${SCORE_WEIGHTS.base} + S1×${SCORE_WEIGHTS.s1 * 100}% + S2×${SCORE_WEIGHTS.s2 * 100}% + S3×${SCORE_WEIGHTS.s3 * 100}%`,
    `分级：${gradeTable}`,
    "",
    `降级触发（覆盖上面算出的等级）：净资产<0 → 至多 ${DOWNGRADE_RULES.insolvent}；` +
      `净资产<0 且经营现金流为负且流动比率<${DOWNGRADE_RULES.currentRatioThreshold} → 至多 ${DOWNGRADE_RULES.insolventWithCashCrisis}。`,
    "",
    `数据疑似异常的两条比率：(应收+存货)/收入 > ${SUSPECTED_ABNORMAL_THRESHOLDS.receivableInventoryOverRevenue * 100}%；` +
      `其他应收款/总资产 > ${SUSPECTED_ABNORMAL_THRESHOLDS.otherReceivablesOverAssets * 100}%，` +
      `或其他应收款同比增长 > ${SUSPECTED_ABNORMAL_THRESHOLDS.otherReceivablesGrowth * 100}% 且经营现金流为负。`,
  ].join("\n");
}
