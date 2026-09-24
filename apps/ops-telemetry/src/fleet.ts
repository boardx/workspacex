/**
 * 车队投影的纯函数（照 coord-brain 先例：零 IO、零 Workers 依赖，DO 只做取快照、调函数、写结果）。
 *
 * 输入只有两样：契约校验过的上报 + 边缘接收时刻。输出是可以随时丢掉再算的投影——
 * 边缘数据丢光是可恢复事件，不是数据丢失（super-instance-design §3.5）。
 */
import {
  InstanceTelemetryReport,
  TELEMETRY_REPORT_INTERVAL_SECONDS,
  type InstanceTelemetryReportValue,
} from "@repo/contracts/instance-telemetry";

/** 边缘持久化的唯一形状：契约字段原样 + 接收时刻。没有第三个键。 */
export interface StoredReport {
  receivedAt: number; // epoch ms，边缘时钟
  report: InstanceTelemetryReportValue;
}

/** 每实例保留的滚动历史条数（约一个月的日报）。 */
export const HISTORY_LIMIT = 30;
/** 每实例每滚动小时最多接收的上报数；上报周期是一天，这已是宽松上限。 */
export const RATE_LIMIT_PER_HOUR = 6;
/** 请求体上限：契约数组都有上限，满载也远小于此。 */
export const MAX_BODY_BYTES = 256 * 1024;
/** 逾期阈值：超过 2× 契约上报周期没收到上报。周期取自契约，本处不再声明。 */
export const OVERDUE_AFTER_MS = 2 * TELEMETRY_REPORT_INTERVAL_SECONDS * 1000;

export type HealthBucket = "healthy" | "degraded" | "down" | "unreported";
export const HEALTH_BUCKETS: readonly HealthBucket[] = ["healthy", "degraded", "down", "unreported"];

/** 健康分档的阈值——单一事实源。 */
export const HEALTH_THRESHOLDS = { healthyUptime: 0.99, downUptime: 0.9, maxDiskUsed: 0.9 } as const;

export function healthBucket(report: InstanceTelemetryReportValue): HealthBucket {
  const h = report.health;
  if (!h) return "unreported"; // 未同意 health 或本期未带
  if (h.uptimeRatio < HEALTH_THRESHOLDS.downUptime) return "down";
  if (h.uptimeRatio < HEALTH_THRESHOLDS.healthyUptime || h.diskUsedRatio > HEALTH_THRESHOLDS.maxDiskUsed) return "degraded";
  return "healthy";
}

/** 车队索引里每实例一行：全部由 StoredReport 推出。 */
export interface InstanceSummary {
  instanceId: string;
  edition: InstanceTelemetryReportValue["edition"];
  productVersion: string;
  health: HealthBucket;
  periodEnd: string;
  receivedAt: number;
}

export function summarize(stored: StoredReport): InstanceSummary {
  const r = stored.report;
  return {
    instanceId: r.instanceId,
    edition: r.edition,
    productVersion: r.productVersion,
    health: healthBucket(r),
    periodEnd: r.periodEnd,
    receivedAt: stored.receivedAt,
  };
}

export function isOverdue(receivedAt: number, now: number): boolean {
  return now - receivedAt > OVERDUE_AFTER_MS;
}

export interface FleetProjection {
  generatedAt: number;
  reportIntervalSeconds: number;
  overdueAfterMs: number;
  total: number;
  byVersion: Record<string, number>;
  byEdition: Record<string, number>;
  health: Record<HealthBucket, number>;
  overdue: { instanceId: string; receivedAt: number }[];
  instances: (InstanceSummary & { overdue: boolean })[];
}

export function aggregateFleet(summaries: readonly InstanceSummary[], now: number): FleetProjection {
  const byVersion: Record<string, number> = {};
  const byEdition: Record<string, number> = {};
  const health = Object.fromEntries(HEALTH_BUCKETS.map((b) => [b, 0])) as Record<HealthBucket, number>;
  const instances = [...summaries]
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map((s) => ({ ...s, overdue: isOverdue(s.receivedAt, now) }));
  for (const s of instances) {
    byVersion[s.productVersion] = (byVersion[s.productVersion] ?? 0) + 1;
    byEdition[s.edition] = (byEdition[s.edition] ?? 0) + 1;
    health[s.health] += 1;
  }
  return {
    generatedAt: now,
    reportIntervalSeconds: TELEMETRY_REPORT_INTERVAL_SECONDS,
    overdueAfterMs: OVERDUE_AFTER_MS,
    total: instances.length,
    byVersion,
    byEdition,
    health,
    overdue: instances.filter((s) => s.overdue).map((s) => ({ instanceId: s.instanceId, receivedAt: s.receivedAt })),
    instances,
  };
}

/** 接收前的唯一入口：契约 parse。失败即拒——不存在「部分接收」。 */
export function parseReport(body: unknown) {
  return InstanceTelemetryReport.safeParse(body);
}

/** 滑动窗口限流：返回裁剪后的时间戳，以及是否放行本次。 */
export function rateLimit(acceptedAt: readonly number[], now: number): { allowed: boolean; window: number[] } {
  const window = acceptedAt.filter((t) => now - t < 3_600_000);
  if (window.length >= RATE_LIMIT_PER_HOUR) return { allowed: false, window };
  return { allowed: true, window: [...window, now] };
}
