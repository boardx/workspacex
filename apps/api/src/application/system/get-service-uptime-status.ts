/**
 * issue #2645 —— 运营状态屏「红绿 bar + 可用性百分比」读侧,喂给
 * `GET /system/uptime`（`interface/controllers/system-uptime.controller.ts`）。
 *
 * 2026-09-14：窗口从"最近 120 次"改成**最近 24 小时**（人类要求"可以看一天的"），
 * bar 按 15 分钟一格等分成 96 桶（见 `domain/system/service-uptime.ts` 的
 * `bucketUptimeChecks`），百分比仍按窗口内每一次探活精确计算。
 */
import { bucketUptimeChecks, computeUptimeAvailability, type UptimeCheckBucket } from "../../domain/system/service-uptime";
import type { ServiceUptimeRepository, ServiceUptimeTargetInfo } from "./uptime-ports";

export const UPTIME_WINDOW_HOURS = 24;
export const UPTIME_BUCKET_MINUTES = 15;
export const UPTIME_BUCKET_COUNT = (UPTIME_WINDOW_HOURS * 60) / UPTIME_BUCKET_MINUTES;

export interface GetServiceUptimeStatusOut extends ServiceUptimeTargetInfo {
  readonly windowHours: number;
  readonly bucketMinutes: number;
  readonly buckets: readonly UptimeCheckBucket[];
  readonly totalChecks: number;
  readonly upChecks: number;
  readonly availabilityPercent: number | null;
}

export async function getServiceUptimeStatus(
  repo: ServiceUptimeRepository,
  target: ServiceUptimeTargetInfo,
  now: Date = new Date(),
): Promise<GetServiceUptimeStatusOut> {
  const bucketMs = UPTIME_BUCKET_MINUTES * 60_000;
  const since = new Date(now.getTime() - bucketMs * UPTIME_BUCKET_COUNT);
  const records = target.configured ? await repo.listSince(target.service, since) : [];
  const checks = records
    .filter((r) => r.checkedAt.getTime() < now.getTime())
    .map((r) => ({ checkedAt: r.checkedAt.toISOString(), isUp: r.isUp }));
  const { totalChecks, upChecks, availabilityPercent } = computeUptimeAvailability(checks);
  const buckets = bucketUptimeChecks(checks, { windowEnd: now, bucketMs, bucketCount: UPTIME_BUCKET_COUNT });
  return { ...target, windowHours: UPTIME_WINDOW_HOURS, bucketMinutes: UPTIME_BUCKET_MINUTES, buckets, totalChecks, upChecks, availabilityPercent };
}
