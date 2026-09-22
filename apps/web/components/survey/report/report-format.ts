export const reportNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

export const REPORT_COLORS = ["#237c74", "#548bc1", "#b58b46", "#8c78ad", "#ce7663"];
