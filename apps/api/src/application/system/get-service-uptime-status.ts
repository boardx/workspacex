/**
 * issue #2645 —— 运营状态屏「红绿 bar + 可用性百分比」读侧,喂给
 * `GET /system/uptime`（`interface/controllers/system-uptime.controller.ts`）。
 */
import { computeUptimeAvailability, type UptimeAvailability } from "../../domain/system/service-uptime";
import type { ServiceUptimeRepository } from "./uptime-ports";

/** 红绿 bar 展示最近多少个 ping 点——需求只要"简单形式",不需要可配置,给个够画出一条有意义的 bar 的定量。 */
export const UPTIME_STATUS_SAMPLE_SIZE = 120;

export interface GetServiceUptimeStatusOut extends UptimeAvailability {
  readonly service: string;
  /** 这个部署根本没配探活目标（`DEV_APP_UPTIME_URL` 未设置）——界面据此渲染"未配置",不是空 bar。 */
  readonly configured: boolean;
}

export async function getServiceUptimeStatus(
  repo: ServiceUptimeRepository,
  service: string,
  configured: boolean,
): Promise<GetServiceUptimeStatusOut> {
  const records = await repo.listRecent(service, UPTIME_STATUS_SAMPLE_SIZE);
  const availability = computeUptimeAvailability(
    records.map((r) => ({ checkedAt: r.checkedAt.toISOString(), isUp: r.isUp })),
  );
  return { ...availability, service, configured };
}
