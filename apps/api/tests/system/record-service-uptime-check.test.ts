/**
 * issue #2645 —— `recordServiceUptimeCheck` 用例：探活结果如实落库，探活失败不是抛异常。
 */
import { describe, expect, it, vi } from "vitest";
import { recordServiceUptimeCheck, UPTIME_HOUSEKEEPING_EVERY } from "../../src/application/system/record-service-uptime-check";
import type { ServiceUptimeCheckRecord, ServiceUptimeProbe, ServiceUptimeRepository } from "../../src/application/system/uptime-ports";
import type { LoggerPort } from "../../src/application/ports/logger.port";

function fakeLogger(): LoggerPort {
  return { info: vi.fn(), error: vi.fn() };
}

function fakeRepo(): ServiceUptimeRepository & { records: ServiceUptimeCheckRecord[]; sweptDays: number[] } {
  const records: ServiceUptimeCheckRecord[] = [];
  const sweptDays: number[] = [];
  return {
    records,
    sweptDays,
    record: vi.fn(async (entry) => { records.push(entry); }),
    listRecent: vi.fn(async () => records),
    sweepExpired: vi.fn(async (days: number) => { sweptDays.push(days); }),
  };
}

describe("recordServiceUptimeCheck", () => {
  it("探活成功：记一条 isUp: true，不记日志错误", async () => {
    const probe: ServiceUptimeProbe = { check: vi.fn(async () => ({ isUp: true, latencyMs: 42, error: null })) };
    const repo = fakeRepo();
    const logger = fakeLogger();
    const now = new Date("2026-09-04T00:00:00.000Z");

    await recordServiceUptimeCheck(
      { probe, repo, logger, now: () => now },
      { service: "dev_app", url: "https://dev.example.com/", timeoutMs: 10_000, callCount: 1 },
    );

    expect(repo.records).toEqual([{ service: "dev_app", checkedAt: now, isUp: true, latencyMs: 42, error: null }]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("探活失败：如实记 isUp: false + 原因，并记一条 error 日志（不是抛异常）", async () => {
    const probe: ServiceUptimeProbe = { check: vi.fn(async () => ({ isUp: false, latencyMs: 10_000, error: "timeout" })) };
    const repo = fakeRepo();
    const logger = fakeLogger();

    await recordServiceUptimeCheck(
      { probe, repo, logger, now: () => new Date("2026-09-04T00:01:00.000Z") },
      { service: "dev_app", url: "https://dev.example.com/", timeoutMs: 10_000, callCount: 2 },
    );

    expect(repo.records[0]).toMatchObject({ isUp: false, error: "timeout" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it(`每 ${UPTIME_HOUSEKEEPING_EVERY} 次顺手扫一次过期数据,其余次数不扫`, async () => {
    const probe: ServiceUptimeProbe = { check: vi.fn(async () => ({ isUp: true, latencyMs: 1, error: null })) };
    const repo = fakeRepo();
    const logger = fakeLogger();

    await recordServiceUptimeCheck(
      { probe, repo, logger, now: () => new Date() },
      { service: "dev_app", url: "https://dev.example.com/", timeoutMs: 10_000, callCount: 1 },
    );
    expect(repo.sweptDays).toEqual([]);

    await recordServiceUptimeCheck(
      { probe, repo, logger, now: () => new Date() },
      { service: "dev_app", url: "https://dev.example.com/", timeoutMs: 10_000, callCount: UPTIME_HOUSEKEEPING_EVERY },
    );
    expect(repo.sweptDays).toEqual([30]);
  });
});
