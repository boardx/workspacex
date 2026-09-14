/**
 * issue #2645 —— 探活目标的部署配置。可选子系统（同 `lazyTransactionalMailConfig`
 * 那一类）：没配就不探活,不拖垮 API 启动,也不在生产强制要求——这是运维自查的
 * 锦上添花能力,不是核心业务路径。
 */
import type { ServiceUptimeTarget, ServiceUptimeTargetInfo } from "../../application/system/uptime-ports";

export const DEV_APP_SERVICE_NAME = "dev_app";
/** 没有显式 `DEV_APP_UPTIME_URL` 时探活本部署自己的公开地址（`APP_PUBLIC_URL`）。 */
export const PUBLIC_APP_SERVICE_NAME = "public_app";

export interface ServiceUptimeConfig {
  /** 空字符串 = 未配置,worker 不启动计时器。 */
  readonly url: string;
  readonly timeoutMs: number;
  readonly service: string;
}

export const SERVICE_UPTIME_CONFIG = Symbol("ServiceUptimeConfig");

/**
 * 目标解析顺序：显式 `DEV_APP_UPTIME_URL` > 本部署的 `APP_PUBLIC_URL`。
 * 2026-09-14 boardx.com.cn 后台一直显示"还没有配置探活目标"——那个部署是
 * `cloud-deploy` 渲染的，不会有人去手填 `DEV_APP_UPTIME_URL`；而"这个部署自己
 * 从公网能不能打开"正是运营状态屏最想回答的问题，`APP_PUBLIC_URL` 就是它。
 * 两种来源用不同的 `service` 名落库，避免切换配置后新旧记录混在一条 bar 里。
 */
export function serviceUptimeConfig(env: NodeJS.ProcessEnv = process.env): ServiceUptimeConfig {
  const explicit = (env.DEV_APP_UPTIME_URL ?? "").trim();
  const publicUrl = (env.APP_PUBLIC_URL ?? "").trim();
  if (explicit.length > 0) return { url: explicit, timeoutMs: 10_000, service: DEV_APP_SERVICE_NAME };
  return { url: publicUrl, timeoutMs: 10_000, service: PUBLIC_APP_SERVICE_NAME };
}

/**
 * `ServiceUptimeTarget` 的实现——把具体的 `ServiceUptimeConfig`（infra 类型）折成
 * 应用层端口能给出的最小信息（`service` + `configured`），是 controller 允许触达的
 * 唯一形状。见 `application/system/uptime-ports.ts` 里 `ServiceUptimeTarget` 头注。
 */
export class ConfiguredServiceUptimeTarget implements ServiceUptimeTarget {
  constructor(private readonly config: ServiceUptimeConfig) {}
  info(): ServiceUptimeTargetInfo {
    const configured = this.config.url.length > 0;
    return { service: this.config.service, configured, target: configured ? this.config.url : null };
  }
}
