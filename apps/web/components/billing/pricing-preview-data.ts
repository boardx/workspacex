/** UI-only fixtures for #6086. Not an API contract or a production price catalog. */
export type PricingRegion = "cn" | "us" | "devapp";
export type PricingCycle = "month" | "year";
export type PricingView = "personal" | "team" | "admin";
export type PricingState = "default" | "loading" | "empty" | "invalid" | "depfail" | "denied" | "success";
export const PRICING_STATES: readonly PricingState[] = ["default", "loading", "empty", "invalid", "depfail", "denied", "success"];
export const STATE_LABELS: Record<PricingState, string> = {
  default: "默认", loading: "加载", empty: "空", invalid: "校验失败", depfail: "依赖失败", denied: "无权限", success: "成功",
};
const prices = {
  cn: { symbol: "¥", pro: { month: 199, year: 1990 }, team: { month: 999, year: 9990 }, seat: { month: 149, year: 1490 }, enterprise: 29800, packs: [129, 599, 2199] },
  us: { symbol: "$", pro: { month: 29, year: 290 }, team: { month: 149, year: 1490 }, seat: { month: 25, year: 250 }, enterprise: 6000, packs: [19, 89, 329] },
} as const;
export const PACK_CREDITS = [10000, 50000, 200000] as const;
export function previewPrices(region: PricingRegion) { return prices[region === "us" ? "us" : "cn"]; }
export function previewMoney(region: PricingRegion, value: number) {
  return `${previewPrices(region).symbol}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
export const numberLabel = (value: number) => value.toLocaleString("en-US");
