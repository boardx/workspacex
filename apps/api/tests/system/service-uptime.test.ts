/**
 * issue #2645 —— `computeUptimeAvailability` 纯函数单测。
 */
import { describe, expect, it } from "vitest";
import { computeUptimeAvailability } from "../../src/domain/system/service-uptime";

describe("computeUptimeAvailability", () => {
  it("没有记录时百分比是 null，不是 0 或 100", () => {
    const out = computeUptimeAvailability([]);
    expect(out).toEqual({ segments: [], totalChecks: 0, upChecks: 0, availabilityPercent: null });
  });

  it("按 checkedAt 升序排列，百分比精确到小数点后两位", () => {
    const out = computeUptimeAvailability([
      { checkedAt: "2026-09-04T00:02:00.000Z", isUp: true },
      { checkedAt: "2026-09-04T00:00:00.000Z", isUp: true },
      { checkedAt: "2026-09-04T00:01:00.000Z", isUp: false },
    ]);
    expect(out.segments.map((s) => s.checkedAt)).toEqual([
      "2026-09-04T00:00:00.000Z",
      "2026-09-04T00:01:00.000Z",
      "2026-09-04T00:02:00.000Z",
    ]);
    expect(out.totalChecks).toBe(3);
    expect(out.upChecks).toBe(2);
    expect(out.availabilityPercent).toBeCloseTo(66.67, 2);
  });

  it("全部可用时是精确的 100，不是四舍五入之后碰巧等于 100", () => {
    const out = computeUptimeAvailability(
      Array.from({ length: 2000 }, (_, i) => ({ checkedAt: `2026-09-04T00:00:${String(i % 60).padStart(2, "0")}.000Z`, isUp: true })),
    );
    expect(out.availabilityPercent).toBe(100);
  });

  it("1999/2000 可用 -> 99.95，不是被四舍五入到整数", () => {
    const checks = Array.from({ length: 2000 }, (_, i) => ({
      checkedAt: `2026-09-04T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      isUp: i !== 0,
    }));
    const out = computeUptimeAvailability(checks);
    expect(out.availabilityPercent).toBe(99.95);
  });
});
