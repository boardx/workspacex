/**
 * 2026-09-08——收件箱「反馈 / 设计方案标签」的端口（侧表 `inbox_item_tags`）。
 *
 * ⚠ 仓储按组织构造（`forOrg`），同 `InboxOrderRepository` 的理由。
 * ⚠ `kind` 只有 `feedback | design`：系统异常的标签在 `error_logs.tags`，写路径是
 *   `updateSystemErrorLifecycle`——见契约 `InboxItem` 头注「`tags`」。
 */
export const INBOX_TAG_REPOSITORY = Symbol("InboxTagRepository");

export type InboxTaggableKind = "feedback" | "design";

export interface InboxTagRepository {
  /** 这个组织全部已打过标签的条目，`boardOrderKey(kind,id)` → tags。全量读，同 `getOrders`。 */
  getTags(): Promise<ReadonlyMap<string, readonly string[]>>;
  /** 覆盖式写入一条条目的标签集合（空数组也写：表示"清空"）。 */
  setTags(kind: InboxTaggableKind, id: string, tags: readonly string[]): Promise<void>;
}

export interface InboxTagRepositoryFactory {
  forOrg(orgId: string): InboxTagRepository;
}
