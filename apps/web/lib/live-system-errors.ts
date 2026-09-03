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
export type SystemErrorStatus = z.infer<typeof systemErrorLogs.SystemErrorStatus>;
export type ListSystemErrorLogsOut = z.infer<typeof systemErrorLogs.operations.listSystemErrorLogs.out>;
export type UpdateSystemErrorLifecycleOut = z.infer<typeof systemErrorLogs.operations.updateSystemErrorLifecycle.out>;

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

/**
 * 系统异常的生命周期(状态/理由/开发备注)与标签更新——见契约 `updateSystemErrorLifecycle`
 * 头注。`status` 省略 = 不改状态，只改 `devNote`/`tags`；其余字段省略 = 保留现值。
 */
export async function updateSystemErrorLifecycle(
  id: string,
  patch: {
    readonly status?: SystemErrorStatus;
    readonly statusReason?: string | null;
    readonly devNote?: string | null;
    readonly tags?: readonly string[];
  },
): Promise<UpdateSystemErrorLifecycleOut> {
  return apiRequest<UpdateSystemErrorLifecycleOut>(`/system/error-logs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { id, ...patch },
  });
}

/* ─────────────────────────── 测试邮件（平台超管） ─────────────────────────── */

export type SendTestEmailOut = z.infer<typeof systemErrorLogs.operations.sendTestEmail.out>;

/**
 * 用生产同一条事务邮件通路发一封测试邮件（见契约 `sendTestEmail` 头注）。
 * `to` 省略 = 发给当前账号自己的邮箱。失败原样抛 `ApiError`——`reasonCode` 是
 * `MAIL_NOT_CONFIGURED` / `MAIL_SEND_FAILED`（响应体另带 `category`）/ `NO_RECIPIENT`。
 */
export async function sendTestEmail(to?: string): Promise<SendTestEmailOut> {
  return apiRequest<SendTestEmailOut>(systemErrorLogs.operations.sendTestEmail.path, {
    method: "POST",
    body: to !== undefined && to.trim() !== "" ? { to: to.trim() } : {},
  });
}
