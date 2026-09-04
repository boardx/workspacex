/**
 * issue #2645 —— 服务可用性 ping 的应用层端口（依赖倒置：这里只定义接口，
 * `infrastructure/system/*` 落地实现）。
 */

/** 探活一次的结果。`error` 是给日志/诊断看的粗粒度原因，不是原始异常堆栈。 */
export interface ServiceUptimeProbeResult {
  readonly isUp: boolean;
  readonly latencyMs: number | null;
  readonly error: string | null;
}

/** 打一次 HTTP 探活。实现方对超时/网络错误负责，不向调用方抛异常——探活失败本身就是"中断"这个业务结果，不是端口意义上的错误。 */
export interface ServiceUptimeProbe {
  check(url: string, timeoutMs: number): Promise<ServiceUptimeProbeResult>;
}
export const SERVICE_UPTIME_PROBE = Symbol("ServiceUptimeProbe");

export interface ServiceUptimeCheckRecord {
  readonly service: string;
  readonly checkedAt: Date;
  readonly isUp: boolean;
  readonly latencyMs: number | null;
  readonly error: string | null;
}

export interface ServiceUptimeRepository {
  record(entry: ServiceUptimeCheckRecord): Promise<void>;
  /** 最近 `limit` 条,顺序不保证——`computeUptimeAvailability` 自己会排序。 */
  listRecent(service: string, limit: number): Promise<readonly ServiceUptimeCheckRecord[]>;
  /** 清掉超过 `olderThanDays` 天的记录——同 `error_logs` 的 `sweepExpiredErrorLogs` 套路。 */
  sweepExpired(olderThanDays: number): Promise<void>;
}
export const SERVICE_UPTIME_REPOSITORY = Symbol("ServiceUptimeRepository");

/**
 * 探活目标是哪个 service、这个部署有没有配它——`SystemUptimeController` 需要知道
 * "配了但还没有数据" 和 "根本没配" 的区别（见契约 `getServiceUptimeStatus` 头注的
 * `configured` 字段），但 interface 层不能直接 import `infrastructure/system/service-uptime-config.ts`
 * 那个具体配置类型（`lint-arch-deps` 门控：onion 架构下 interface 只能依赖 application 端口）。
 * 这个端口就是那道边界——`infrastructure` 提供一个只读实现,包一层 `serviceUptimeConfig()`。
 */
export interface ServiceUptimeTargetInfo {
  readonly service: string;
  readonly configured: boolean;
}
export interface ServiceUptimeTarget {
  info(): ServiceUptimeTargetInfo;
}
export const SERVICE_UPTIME_TARGET = Symbol("ServiceUptimeTarget");
