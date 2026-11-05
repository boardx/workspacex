import { describe, expect, it } from "vitest";
import { humanTime } from "@/lib/human-time";

// Local civil times deliberately preserve the helper's original host-timezone behavior.
const now = new Date(2026, 10, 5, 12, 0, 0).getTime();
const iso = (timestamp: number) => new Date(timestamp).toISOString();
describe("humanTime display locale with unchanged time boundaries", () => {
  it.each([
    [0, "刚刚", "Just now"],
    [59_999, "刚刚", "Just now"],
    [60_000, "1 分钟前", "1 minute ago"],
    [120_000, "2 分钟前", "2 minutes ago"],
    [59 * 60_000, "59 分钟前", "59 minutes ago"],
    [60 * 60_000, "今天 11:00", "Today 11:00"],
    [24 * 60 * 60_000, "昨天 12:00", "Yesterday 12:00"],
    [48 * 60 * 60_000, "11/3 12:00", "11/3 12:00"],
  ] as const)("keeps the original %d ms boundary and defaults to Chinese", (age, zh, en) => {
    const value = iso(now - age);
    expect(humanTime(value, now)).toBe(zh);
    expect(humanTime(value, now, "zh-CN")).toBe(zh);
    expect(humanTime(value, now, "en")).toBe(en);
  });

  it("preserves invalid input verbatim and future times without negative relative values", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      expect(humanTime("原始无效日期 {date}", now, locale)).toBe("原始无效日期 {date}");
      expect(humanTime(iso(now + 3 * 60_000), now, locale)).toBe("12:03");
    }
  });
});
