import type { UsageCalls, UsageSummary } from "@/lib/live-ai-usage";

export const USAGE_TIMEZONE = "Asia/Shanghai";
const DAY_MS = 86_400_000;
export const formatTokens = (value: string | null) => value === null ? "未上报" : BigInt(value).toLocaleString("zh-CN");
export const usageDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: USAGE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const usageDateLabel = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: USAGE_TIMEZONE, year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
export const usageTime = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: USAGE_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
export type DatePreset = "today" | "week" | "month";
export function dateRange(preset: DatePreset, now = new Date()) {
  const end = usageDay(now.toISOString());
  const start = preset === "today" ? end : preset === "month" ? `${end.slice(0, 7)}-01` : usageDay(new Date(now.getTime() - 6 * DAY_MS).toISOString());
  return { start, end };
}
/** UI end date is inclusive; ledger end timestamp is exclusive. */
export function dateQuery(start: string, end: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
    const date = new Date(`${value}T00:00:00+08:00`);
    if (!Number.isFinite(date.getTime()) || usageDay(date.toISOString()) !== value) throw new Error("Invalid date");
    return date;
  };
  const begin = parse(start), finish = new Date(parse(end).getTime() + DAY_MS);
  if (finish <= begin || finish.getTime() - begin.getTime() > 366 * DAY_MS) throw new Error("Invalid window");
  return { start: begin.toISOString(), end: finish.toISOString(), timezone: USAGE_TIMEZONE, limit: 25 };
}
export function recordedTotal(current: UsageSummary["current"]) {
  if (current.callCount > 0 && current.nativeCalls === current.callCount) return "Token 不适用";
  if (current.unknownCalls > 0 && current.reportedCalls + current.legacyCalls === 0) return "未上报";
  return formatTokens(current.totalTokens);
}
/** Trend buckets do not carry coverage counts; zero in a partial report is ambiguous. */
export function recordedBucketTotal(current: UsageSummary["current"], totalTokens: string) {
  if (totalTokens === "0" && (current.unknownCalls > 0 || current.nativeCalls > 0)) {
    const total = recordedTotal({ ...current, totalTokens });
    return total === "0" ? "用量待确认" : total;
  }
  return formatTokens(totalTokens);
}
export const UNIT_LABELS = { image: "张图片", pixel: "像素", millisecond: "毫秒", microsecond: "微秒", character: "字符", request: "次请求" };
export function nativeQuantity(usage: NonNullable<UsageCalls["calls"][number]["nativeUsage"]>) {
  return `${formatTokens(usage.quantity)} ${UNIT_LABELS[usage.unit]}${usage.source === "estimated" ? "（估算）" : usage.source === "unknown" ? "（未上报）" : ""}`;
}
export function costLabel(call: UsageCalls["calls"][number]) {
  if (call.costMicros === null || call.currency === null) return "暂无数据";
  const micros = BigInt(call.costMicros);
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")} ${call.currency}`;
}
