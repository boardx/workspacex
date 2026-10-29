import { describe, expect, it } from "vitest";
import { costLabel, dateQuery, dateRange, recordedTotal, usageDay } from "../../components/admin/ai-usage-format";
import type { UsageCalls, UsageSummary } from "../../lib/live-ai-usage";

describe("usage presentation boundaries", () => {
  it("uses Beijing month/day boundaries even when UTC is the previous month", () => {
    expect(dateRange("month", new Date("2026-09-30T17:00:00Z"))).toEqual({ start: "2026-10-01", end: "2026-10-01" });
    expect(dateRange("week", new Date("2026-09-30T17:00:00Z"))).toEqual({ start: "2026-09-25", end: "2026-10-01" });
    expect(usageDay("2026-09-30T17:00:00Z")).toBe("2026-10-01");
    expect(dateQuery("2026-10-01", "2026-10-01")).toMatchObject({ start: "2026-09-30T16:00:00.000Z", end: "2026-10-01T16:00:00.000Z" });
  });
  it("rejects invalid, reversed, and overly long dates", () => {
    for (const [start, end] of [["2026-02-30", "2026-03-01"], ["2026-10-02", "2026-10-01"], ["2025-01-01", "2026-10-01"], ["", "2026-10-01"]] as const) {
      expect(() => dateQuery(start, end)).toThrow();
    }
  });
  it("distinguishes real zero, unknown, mixed and native-only usage", () => {
    const base = { callCount: 1, reportedCalls: 1, legacyCalls: 0, nativeCalls: 0, unknownCalls: 0, totalTokens: "0" } as UsageSummary["current"];
    expect(recordedTotal(base)).toBe("0");
    expect(recordedTotal({ ...base, reportedCalls: 0, unknownCalls: 1 })).toBe("未上报");
    expect(recordedTotal({ ...base, callCount: 2, unknownCalls: 1, totalTokens: "1234" })).toBe("1,234");
    expect(recordedTotal({ ...base, reportedCalls: 0, nativeCalls: 1 })).toBe("Token 不适用");
  });
  it("preserves micro-cost precision and never converts missing prices to zero", () => {
    const cost = { costMicros: "1", currency: "CNY" } as UsageCalls["calls"][number];
    expect(costLabel(cost)).toBe("0.000001 CNY");
    expect(costLabel({ ...cost, costMicros: "0" })).toBe("0.000000 CNY");
    expect(costLabel({ ...cost, costMicros: null })).toBe("暂无数据");
  });
});
