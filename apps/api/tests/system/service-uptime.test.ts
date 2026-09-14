/**
 * issue #2645 —— `computeUptimeAvailability` 纯函数单测。
 */
import { describe, expect, it, vi } from "vitest";
import { bucketUptimeChecks, computeUptimeAvailability } from "../../src/domain/system/service-uptime";
import { UPTIME_BUCKET_COUNT, UPTIME_BUCKET_MINUTES, UPTIME_WINDOW_HOURS, getServiceUptimeStatus } from "../../src/application/system/get-service-uptime-status";
import { serviceUptimeConfig, ConfiguredServiceUptimeTarget } from "../../src/infrastructure/system/service-uptime-config";

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

describe("bucketUptimeChecks（2026-09-14：看一天，按 15 分钟一桶）", () => {
  const windowEnd = new Date("2026-09-14T12:00:00.000Z");
  const bucketMs = 15 * 60_000;

  it("窗口等分成 bucketCount 个左闭右开的桶，没有记录的桶是 no_data，不冒充可用", () => {
    const out = bucketUptimeChecks([], { windowEnd, bucketMs, bucketCount: 4 });
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ from: "2026-09-14T11:00:00.000Z", to: "2026-09-14T11:15:00.000Z", checks: 0, downChecks: 0, status: "no_data" });
    expect(out[3]!.to).toBe("2026-09-14T12:00:00.000Z");
  });

  it("桶内任意一次中断 ⇒ down；全部可用 ⇒ up；窗口外的记录忽略", () => {
    const out = bucketUptimeChecks([
      { checkedAt: "2026-09-14T11:00:00.000Z", isUp: true },
      { checkedAt: "2026-09-14T11:14:59.000Z", isUp: true },
      { checkedAt: "2026-09-14T11:15:00.000Z", isUp: true },
      { checkedAt: "2026-09-14T11:20:00.000Z", isUp: false },
      { checkedAt: "2026-09-14T10:59:59.000Z", isUp: false }, // 窗口前
      { checkedAt: "2026-09-14T12:00:00.000Z", isUp: false }, // 窗口末端（右开）
    ], { windowEnd, bucketMs, bucketCount: 4 });
    expect(out.map((b) => b.status)).toEqual(["up", "down", "no_data", "no_data"]);
    expect(out[0]!.checks).toBe(2);
    expect(out[1]).toMatchObject({ checks: 2, downChecks: 1 });
  });
});

describe("getServiceUptimeStatus（24 小时窗口）", () => {
  it("窗口 = 24h / 15min = 96 桶；只查 since 之后的记录；百分比按窗口内每一次探活算", async () => {
    expect(UPTIME_WINDOW_HOURS).toBe(24);
    expect(UPTIME_BUCKET_MINUTES).toBe(15);
    expect(UPTIME_BUCKET_COUNT).toBe(96);
    const now = new Date("2026-09-14T12:00:00.000Z");
    const listSince = vi.fn(async () => [
      { service: "public_app", checkedAt: new Date("2026-09-14T11:59:00.000Z"), isUp: true, latencyMs: 1, error: null },
      { service: "public_app", checkedAt: new Date("2026-09-13T12:30:00.000Z"), isUp: false, latencyMs: null, error: "timeout" },
    ]);
    const out = await getServiceUptimeStatus(
      { record: vi.fn(), listSince, sweepExpired: vi.fn() },
      { service: "public_app", configured: true, target: "https://boardx.example/" },
      now,
    );
    expect(listSince).toHaveBeenCalledWith("public_app", new Date("2026-09-13T12:00:00.000Z"));
    expect(out.buckets).toHaveLength(96);
    expect(out.buckets[95]!.status).toBe("up");
    expect(out.buckets[2]!.status).toBe("down");
    expect(out).toMatchObject({ totalChecks: 2, upChecks: 1, availabilityPercent: 50, target: "https://boardx.example/", windowHours: 24, bucketMinutes: 15 });
  });

  it("未配置时不查库，返回空桶", async () => {
    const listSince = vi.fn(async () => []);
    const out = await getServiceUptimeStatus({ record: vi.fn(), listSince, sweepExpired: vi.fn() }, { service: "public_app", configured: false, target: null });
    expect(listSince).not.toHaveBeenCalled();
    expect(out.totalChecks).toBe(0);
    expect(out.availabilityPercent).toBeNull();
  });
});

describe("serviceUptimeConfig（探活目标解析）", () => {
  it("显式 DEV_APP_UPTIME_URL 优先，service=dev_app", () => {
    const c = serviceUptimeConfig({ DEV_APP_UPTIME_URL: "https://dev.example/", APP_PUBLIC_URL: "https://app.example/" } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ url: "https://dev.example/", service: "dev_app" });
  });
  it("没有 DEV_APP_UPTIME_URL 时回退到本部署的 APP_PUBLIC_URL，service=public_app", () => {
    const c = serviceUptimeConfig({ APP_PUBLIC_URL: "https://boardx.example/" } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ url: "https://boardx.example/", service: "public_app" });
    expect(new ConfiguredServiceUptimeTarget(c).info()).toEqual({ service: "public_app", configured: true, target: "https://boardx.example/" });
  });
  it("两个都没有 ⇒ 未配置，target 为 null", () => {
    const c = serviceUptimeConfig({} as NodeJS.ProcessEnv);
    expect(new ConfiguredServiceUptimeTarget(c).info()).toEqual({ service: "public_app", configured: false, target: null });
  });
});
