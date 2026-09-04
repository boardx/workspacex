/**
 * UC-17.8 B3.4 —— 运营收件箱的真实 API 薄封装（契约 `inbox`）。
 *
 * 类型全部走 `z.infer`（`lint-contract-source` 要求）：这里**不重新声明**任何字段名或
 * 枚举值。`InboxKind`/`InboxStage`/`InboxItem`/`stageOf` 的唯一事实源是
 * `packages/contracts/src/inbox.ts`，本文件只是薄薄一层 `apiRequest` 封装。
 *
 * ⚠ 这份契约**只读**（见契约文件头）：没有 `PUT /inbox/:id/status`。状态迁移仍然是
 *   `feedbackLoop.operations.triageFeedback` / `systemErrorLogs.operations.updateSystemErrorLifecycle`
 *   ——本文件不包，调用方直接从 `live-feedback.ts` / `live-system-errors.ts` 取。
 */
import { inbox } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type InboxKind = z.infer<typeof inbox.InboxKind>;
export type InboxStage = z.infer<typeof inbox.InboxStage>;
export type InboxItem = z.infer<typeof inbox.InboxItem>;
export type InboxGithubRef = z.infer<typeof inbox.InboxGithubRef>;
export type InboxExceptionMeta = z.infer<typeof inbox.InboxExceptionMeta>;
export type InboxSources = z.infer<typeof inbox.InboxSources>;
export type ListInboxOut = z.infer<typeof inbox.operations.listInbox.out>;
export type GetInboxCountsOut = z.infer<typeof inbox.operations.getInboxCounts.out>;

/** stage → 显示名 + 看板列顺序。派生值的展示层，不是第二份状态机（见契约文件头）。 */
export const INBOX_STAGE_ORDER: readonly InboxStage[] = inbox.InboxStage.options;
export const INBOX_STAGE_LABEL: Record<InboxStage, string> = {
  backlog: "待处理",
  doing: "进行中",
  done: "已完成",
  archived: "不做",
};

/** kind → 显示名，含全部/系统异常/设计方案闭集，供筛选 Chip 用。 */
export const INBOX_KIND_OPTIONS = inbox.InboxKind.options;
export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  feedback: "反馈",
  exception: "系统异常",
  design: "设计方案",
};

export { stageOf, INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD } from "@repo/contracts/inbox";

export async function listInbox(input?: {
  readonly kind?: InboxKind;
  readonly stage?: InboxStage;
  readonly q?: string;
  readonly limit?: number;
  readonly cursor?: string;
}): Promise<ListInboxOut> {
  return apiRequest<ListInboxOut>(inbox.operations.listInbox.path, {
    query: {
      kind: input?.kind,
      stage: input?.stage,
      q: input?.q !== undefined && input.q.trim() !== "" ? input.q.trim() : undefined,
      limit: input?.limit !== undefined ? String(input.limit) : undefined,
      cursor: input?.cursor,
    },
  });
}

export async function getInboxCounts(): Promise<GetInboxCountsOut> {
  return apiRequest<GetInboxCountsOut>(inbox.operations.getInboxCounts.path);
}
