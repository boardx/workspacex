/**
 * `getBackgroundTask`（F112 · uc-8-2 · 批准通过后的回流查询）。
 *
 * ⚠ 最小占位实现——见迁移 `20260801130000_f112_approval_gate.sql` 文件头：11-task
 * （真实任务队列）束尚未落地，`chat_background_tasks` 只是 F112 范围内记录「批准通过
 * 后有一个任务在跑」的一行状态，不是真实编排系统的读投影。
 */
import type { OrgId } from "../../domain/org-id";
import type { ChatRepository } from "./ports";

export class BackgroundTaskNotFoundError extends Error {
  constructor() {
    super("task_not_found");
  }
}

export interface GetBackgroundTaskDeps {
  readonly chat: ChatRepository;
}

export interface GetBackgroundTaskResult {
  readonly status: "queued" | "running" | "needs-input" | "done" | "failed" | "cancelled";
  readonly resultMessageId: string | null;
}

export async function getBackgroundTask(
  deps: GetBackgroundTaskDeps,
  input: { readonly orgId: OrgId; readonly taskId: string },
): Promise<GetBackgroundTaskResult> {
  const row = await deps.chat.findBackgroundTask(input.orgId, input.taskId);
  if (row === null) throw new BackgroundTaskNotFoundError();
  return { status: row.status, resultMessageId: row.resultMessageId };
}
