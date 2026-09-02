/**
 * 系统异常列表的真实 API 薄封装（契约 `systemErrorLogs.operations.listSystemErrorLogs`）。
 *
 * 类型走 `z.infer`——不重新声明字段名（`lint-contract-source` 要求）。
 *
 * ⚠ 这条接口只对"平台超管"放行（见契约文件头），一个非超管账号调用会收到 403
 *   `NOT_PLATFORM_SUPERUSER`——`FeedbackScreen` 据此把这块区域渲染成"仅平台运维
 *   可见"的提示，而不是当成整块屏的失败态。
 */
import { systemErrorLogs } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type SystemErrorLogItem = z.infer<typeof systemErrorLogs.SystemErrorLogItem>;
export type ListSystemErrorLogsOut = z.infer<typeof systemErrorLogs.operations.listSystemErrorLogs.out>;

export async function listSystemErrorLogs(input?: {
  readonly limit?: number;
  readonly beforeId?: string;
}): Promise<ListSystemErrorLogsOut> {
  return apiRequest<ListSystemErrorLogsOut>("/system/error-logs", {
    query: {
      limit: input?.limit !== undefined ? String(input.limit) : undefined,
      beforeId: input?.beforeId,
    },
  });
}
