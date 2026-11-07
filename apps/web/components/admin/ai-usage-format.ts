import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";
import { aiUsageZhCN } from "@/lib/i18n/namespaces/ai-usage";
import type { UsageCalls, UsageSummary } from "@/lib/live-ai-usage";

export const USAGE_TIMEZONE = "Asia/Shanghai";
const DAY_MS = 86_400_000;
export const formatTokens = (value: string | null, locale: Locale = "zh-CN") => value === null ? translate(locale, "aiUsage.notReported") : BigInt(value).toLocaleString(locale);
export const usageDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: USAGE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const usageDateLabel = (value: string, locale: Locale = "zh-CN") => new Intl.DateTimeFormat(locale, { timeZone: USAGE_TIMEZONE, year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
export const usageTime = (value: string, locale: Locale = "zh-CN") => new Intl.DateTimeFormat(locale, { timeZone: USAGE_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
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
export function recordedTotal(current: UsageSummary["current"], locale: Locale = "zh-CN") {
  if (current.callCount > 0 && current.nativeCalls === current.callCount) return translate(locale, "aiUsage.tokensNotApplicable");
  if (current.unknownCalls > 0 && current.reportedCalls + current.legacyCalls === 0) return translate(locale, "aiUsage.notReported");
  return formatTokens(current.totalTokens, locale);
}
/** Trend buckets do not carry coverage counts; zero in a partial report is ambiguous. */
export function recordedBucketTotal(current: UsageSummary["current"], totalTokens: string, locale: Locale = "zh-CN") {
  if (totalTokens === "0" && (current.unknownCalls > 0 || current.nativeCalls > 0)) {
    const total = recordedTotal({ ...current, totalTokens }, locale);
    return total === "0" ? translate(locale, "aiUsage.usagePendingConfirmation") : total;
  }
  return formatTokens(totalTokens, locale);
}
export const UNIT_LABELS = { image: aiUsageZhCN["aiUsage.unit.image"], pixel: aiUsageZhCN["aiUsage.unit.pixel"], millisecond: aiUsageZhCN["aiUsage.unit.millisecond"], microsecond: aiUsageZhCN["aiUsage.unit.microsecond"], character: aiUsageZhCN["aiUsage.unit.character"], request: aiUsageZhCN["aiUsage.unit.request"] };
export function nativeUnitLabel(unit: keyof typeof UNIT_LABELS, locale: Locale = "zh-CN") { return translate(locale, `aiUsage.unit.${unit}`); }
export function nativeQuantity(usage: NonNullable<UsageCalls["calls"][number]["nativeUsage"]>, locale: Locale = "zh-CN") {
  const suffix = usage.source === "estimated" ? translate(locale, "aiUsage.estimated") : usage.source === "unknown" ? translate(locale, "aiUsage.unreportedSuffix") : "";
  return `${formatTokens(usage.quantity, locale)} ${nativeUnitLabel(usage.unit, locale)}${suffix}`;
}
export function costLabel(call: UsageCalls["calls"][number], locale: Locale = "zh-CN") {
  if (call.costMicros === null || call.currency === null) return translate(locale, "aiUsage.noData");
  const micros = BigInt(call.costMicros);
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")} ${call.currency}`;
}

/** Financial hundredths are already rounded per physical request by the ledger. */
export function creditLabel(value?: string | null, locale: Locale = "zh-CN"): string {
 if (value == null) return translate(locale, "aiUsage.noData");
 const hundredths = BigInt(value);
 return `${(hundredths / 100n).toLocaleString(locale)}.${(hundredths % 100n).toString().padStart(2,"0")}`;
}
