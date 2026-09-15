/**
 * 「填入示例数据」按钮用的样例，字段形状对应 `PostinvestRatingController` 的
 * 请求体（`apps/api/src/interface/controllers/postinvest-rating.controller.ts`）。
 * 只是演示数据，不代表任何真实公司。
 */
export const SAMPLE_FINANCIALS = {
  revenue: 600_000_000,
  revenuePriorYear: 500_000_000,
  netProfit: 60_000_000,
  netProfitPriorYear: 50_000_000,
  cashAndEquivalents: 200_000_000,
  operatingCashOutflow12m: 100_000_000,
  operatingCashFlowNet: 30_000_000,
  accountsReceivable: 50_000_000,
  inventory: 30_000_000,
  otherReceivables: 10_000_000,
  otherReceivablesPriorYear: 8_000_000,
  totalAssets: 1_000_000_000,
  netAssets: 500_000_000,
  currentAssets: 300_000_000,
  currentLiabilities: 100_000_000,
} as const;

export const SAMPLE_FACTS = {
  hasFinancialStatement: true,
  standaloneOrOperatingReportOnly: false,
  missingStatementReason: null,
} as const;
