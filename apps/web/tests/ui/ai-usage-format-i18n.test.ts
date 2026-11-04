import { expect, it } from "vitest";
import type { UsageCalls, UsageSummary } from "@/lib/live-ai-usage";
import { creditLabel, costLabel, dateQuery, dateRange, formatTokens, nativeQuantity, recordedBucketTotal, recordedTotal, usageDateLabel, usageDay, usageTime } from "@/components/admin/ai-usage-format";
const base = { callCount: 1, reportedCalls: 1, legacyCalls: 0, nativeCalls: 0, unknownCalls: 0, totalTokens: "0" } as UsageSummary["current"];
it("distinguishes English missing token data from real zero and preserves arbitrary integer precision", () => {
  expect(formatTokens(null, "en")).toBe("Not reported"); expect(formatTokens("0", "en")).toBe("0");
  expect(formatTokens("900719925474099312345", "en")).toBe("900,719,925,474,099,312,345"); expect(formatTokens(null)).toBe("未上报");
});
it("localizes unknown, native-only and mixed totals without changing coverage semantics", () => {
  expect(recordedTotal(base, "en")).toBe("0");
  expect(recordedTotal({ ...base, reportedCalls: 0, unknownCalls: 1 }, "en")).toBe("Not reported");
  expect(recordedTotal({ ...base, reportedCalls: 0, nativeCalls: 1 }, "en")).toBe("Tokens not applicable");
  expect(recordedBucketTotal({ ...base, callCount: 2, nativeCalls: 1 }, "0", "en")).toBe("Usage pending confirmation");
  expect(recordedBucketTotal({ ...base, unknownCalls: 1 }, "12345", "en")).toBe("12,345");
});
it("translates native unit/source presentation while preserving exact quantities and Chinese defaults", () => {
  expect(nativeQuantity({ quantity: "2000", unit: "millisecond", source: "estimated" }, "en")).toBe("2,000 milliseconds (estimated)");
  const missing = nativeQuantity({ quantity: null, unit: "image", source: "unknown" }, "en");
  expect(missing).toContain("(not reported)"); expect(missing).not.toMatch(/\b0\b/);
  expect(nativeQuantity({ quantity: "2000", unit: "millisecond", source: "estimated" })).toBe("2,000 毫秒（估算）");
});
it("preserves six decimal cost precision and currency instead of interpreting locale as market", () => {
  const cost = { costMicros: "900719925474099312345", currency: "CNY" } as UsageCalls["calls"][number];
  expect(costLabel(cost, "en")).toBe("900719925474099.312345 CNY"); expect(costLabel({ ...cost, costMicros: "0" }, "en")).toBe("0.000000 CNY");
  expect(costLabel({ ...cost, costMicros: null }, "en")).toBe("No data"); expect(costLabel({ ...cost, costMicros: null })).toBe("暂无数据");
});
it("preserves already rounded credit hundredths including actual zero and huge integers", () => {
  expect(creditLabel(null, "en")).toBe("No data"); expect(creditLabel("0", "en")).toBe("0.00");
  expect(creditLabel("900719925474099312345", "en")).toBe("9,007,199,254,740,993,123.45"); expect(creditLabel()).toBe("暂无数据");
});
it("localizes display dates while keeping Beijing calendar, midnight query boundaries and 24h time", () => {
  expect(usageDateLabel("2026-09-30T17:00:00Z", "en")).toBe("October 1, 2026"); expect(usageDateLabel("2026-09-30T17:00:00Z")).toBe("2026年10月1日");
  expect(usageTime("2026-09-30T17:00:00Z", "en")).toBe("01:00:00"); expect(usageDay("2026-09-30T17:00:00Z")).toBe("2026-10-01");
  expect(dateRange("month", new Date("2026-09-30T17:00:00Z"))).toEqual({ start: "2026-10-01", end: "2026-10-01" });
  expect(dateQuery("2026-10-01", "2026-10-01")).toEqual({ start: "2026-09-30T16:00:00.000Z", end: "2026-10-01T16:00:00.000Z", timezone: "Asia/Shanghai", limit: 25 });
});
