/**
 * issue #2645 —— 探活目标的部署配置。可选子系统（同 `lazyTransactionalMailConfig`
 * 那一类）：没配就不探活,不拖垮 API 启动,也不在生产强制要求——这是运维自查的
 * 锦上添花能力,不是核心业务路径。
 */
import type { ServiceUptimeTarget, ServiceUptimeTargetInfo } from "../../application/system/uptime-ports";

export const DEV_APP_SERVICE_NAME = "dev_app";

export interface ServiceUptimeConfig {
  /** 空字符串 = 未配置,worker 不启动计时器。 */
  readonly url: string;
  readonly timeoutMs: number;
  readonly service: string;
}

export const SERVICE_UPTIME_CONFIG = Symbol("ServiceUptimeConfig");

export function serviceUptimeConfig(env: NodeJS.ProcessEnv = process.env): ServiceUptimeConfig {
  return {
    url: env.DEV_APP_UPTIME_URL ?? "",
    timeoutMs: 10_000,
    service: DEV_APP_SERVICE_NAME,
  };
}

/**
 * `ServiceUptimeTarget` 的实现——把具体的 `ServiceUptimeConfig`（infra 类型）折成
 * 应用层端口能给出的最小信息（`service` + `configured`），是 controller 允许触达的
 * 唯一形状。见 `application/system/uptime-ports.ts` 里 `ServiceUptimeTarget` 头注。
 */
export class ConfiguredServiceUptimeTarget implements ServiceUptimeTarget {
  constructor(private readonly config: ServiceUptimeConfig) {}
  info(): ServiceUptimeTargetInfo {
    return { service: this.config.service, configured: this.config.url.length > 0 };
  }
}
