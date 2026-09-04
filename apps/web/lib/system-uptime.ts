/**
 * 运营状态屏「服务中断时长与可用性可视化」的真实 API 薄封装（issue #2645，契约
 * `systemUptime.operations.getServiceUptimeStatus`）。
 *
 * 类型走 `z.infer`——不重新声明字段名（`lint-contract-source` 要求）。
 */
import { systemUptime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type UptimeCheckSegment = z.infer<typeof systemUptime.UptimeCheckSegment>;
export type GetServiceUptimeStatusOut = z.infer<typeof systemUptime.operations.getServiceUptimeStatus.out>;

export async function getServiceUptimeStatus(): Promise<GetServiceUptimeStatusOut> {
  return apiRequest<GetServiceUptimeStatusOut>(systemUptime.operations.getServiceUptimeStatus.path);
}
