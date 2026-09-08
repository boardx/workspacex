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
  feedback: "反馈（需求 / 缺陷）",
  exception: "系统异常",
  design: "设计方案",
};

export type InboxView = z.infer<typeof inbox.InboxView>;
export type SetInboxItemTagsOut = z.infer<typeof inbox.operations.setInboxItemTags.out>;

export {
  stageOf,
  isArchivedInboxItem,
  INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD,
  INBOX_TAG_MAX_LENGTH,
  INBOX_TAGS_MAX_COUNT,
} from "@repo/contracts/inbox";

export async function listInbox(input?: {
  readonly kind?: InboxKind;
  readonly excludeKind?: InboxKind;
  readonly stage?: InboxStage;
  readonly q?: string;
  /** 2026-09-08——只列带这个标签的条目（服务端过滤） */
  readonly tag?: string;
  /** 2026-09-08——省略 = 活跃条目；`archived` = 归档箱（见契约 `isArchivedInboxItem`） */
  readonly view?: InboxView;
  readonly limit?: number;
  readonly cursor?: string;
}): Promise<ListInboxOut> {
  return apiRequest<ListInboxOut>(inbox.operations.listInbox.path, {
    query: {
      kind: input?.kind,
      excludeKind: input?.excludeKind,
      stage: input?.stage,
      q: input?.q !== undefined && input.q.trim() !== "" ? input.q.trim() : undefined,
      tag: input?.tag,
      view: input?.view,
      limit: input?.limit !== undefined ? String(input.limit) : undefined,
      cursor: input?.cursor,
    },
  });
}

export async function getInboxCounts(): Promise<GetInboxCountsOut> {
  return apiRequest<GetInboxCountsOut>(inbox.operations.getInboxCounts.path);
}

export type ReorderInboxItemOut = z.infer<typeof inbox.operations.reorderInboxItem.out>;

/**
 * 2026-09-06——列内排序（拖拽排序 / ↑↓ 按钮共用），见契约 `reorderInboxItem` 头注。
 * `orderedIds` 是这一列排序后的**完整**新顺序（`board-reorder.ts` 算），不是增量指令。
 */
export async function reorderInboxItem(
  stage: InboxStage,
  orderedIds: readonly { readonly kind: InboxKind; readonly id: string }[],
): Promise<ReorderInboxItemOut> {
  return apiRequest<ReorderInboxItemOut>(inbox.operations.reorderInboxItem.path, {
    method: "PUT",
    body: { stage, orderedIds },
  });
}

/**
 * 2026-09-08——反馈 / 设计方案打标签（覆盖式），见契约 `setInboxItemTags` 头注。
 * ⚠ 系统异常**不走这里**：它的标签在 `error_logs.tags`，写路径是 `live-system-errors.ts` 的
 *   `updateSystemErrorLifecycle(id, { tags })`——`inbox-screen.tsx` 的 `saveTags` 按 `kind` 选路径。
 */
export async function setInboxItemTags(
  kind: "feedback" | "design",
  id: string,
  tags: readonly string[],
): Promise<SetInboxItemTagsOut> {
  return apiRequest<SetInboxItemTagsOut>(inbox.operations.setInboxItemTags.path, {
    method: "PUT",
    body: { kind, id, tags },
  });
}
