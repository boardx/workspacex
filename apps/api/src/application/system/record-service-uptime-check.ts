/**
 * issue #2645 —— 打一次探活、把结果记下来。由
 * `infrastructure/system/service-uptime-poll-worker.ts` 每隔固定时间调用一次。
 *
 * ⚠ 探活本身失败（网络错误/超时/非 2xx）不是这个用例的"异常"——它是这个用例
 *   存在的理由：把"这次没连上"如实记成一条 `isUp: false` 的记录,不是让调用方
 *   catch 到异常再决定怎么办。`ServiceUptimeProbe.check` 的契约已经保证不抛出。
 */
import type { LoggerPort } from "../ports/logger.port";
import type { ServiceUptimeProbe, ServiceUptimeRepository } from "./uptime-ports";

/** 每隔多少次成功记录顺手扫一次过期数据——同 `pg-error-log-writer.ts` 的 `HOUSEKEEPING_EVERY` 套路,不必每次都扫。 */
export const UPTIME_HOUSEKEEPING_EVERY = 200;
export const UPTIME_RETENTION_DAYS = 30;

export interface RecordServiceUptimeCheckDeps {
  readonly probe: ServiceUptimeProbe;
  readonly repo: ServiceUptimeRepository;
  readonly logger: LoggerPort;
  readonly now: () => Date;
}

export interface RecordServiceUptimeCheckInput {
  readonly service: string;
  readonly url: string;
  readonly timeoutMs: number;
  /** 已经调用过多少次（用于决定这次要不要顺手扫过期数据）,由调用方（worker）持有计数。 */
  readonly callCount: number;
}

export async function recordServiceUptimeCheck(
  deps: RecordServiceUptimeCheckDeps,
  input: RecordServiceUptimeCheckInput,
): Promise<ServiceUptimeProbeResultForRecord> {
  const result = await deps.probe.check(input.url, input.timeoutMs);
  const checkedAt = deps.now();
  await deps.repo.record({
    service: input.service,
    checkedAt,
    isUp: result.isUp,
    latencyMs: result.latencyMs,
    error: result.error,
  });
  if (!result.isUp) {
    deps.logger.error("service uptime check: target reported down", {
      traceId: "service-uptime-poll-worker",
      err: result.error,
      detail: { service: input.service, url: input.url },
    });
  }
  if (input.callCount % UPTIME_HOUSEKEEPING_EVERY === 0) {
    await deps.repo.sweepExpired(UPTIME_RETENTION_DAYS);
  }
  return { checkedAt, isUp: result.isUp };
}

interface ServiceUptimeProbeResultForRecord {
  readonly checkedAt: Date;
  readonly isUp: boolean;
}
