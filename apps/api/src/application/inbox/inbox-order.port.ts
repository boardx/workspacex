/**
 * UC-17.8——收件箱看板「列内排序」的端口。
 *
 * ⚠ **仓储按组织构造（`forOrg`）**，同 `PRODUCT_FEEDBACK_REPOSITORY` 的理由：
 *   `reorderInboxItem.in` 没有 `orgId`（`InboxItem` 本来就不跨组织展示），一个
 *   没有绑定租户的排序仓储是一个能把排序写进别人组织的东西。
 */
import type { BoardOrderKind } from "../../domain/inbox/board-order";

export const INBOX_ORDER_REPOSITORY = Symbol("InboxOrderRepository");

export interface InboxOrderEntry {
  readonly kind: BoardOrderKind;
  readonly id: string;
  readonly order: number;
}

export interface InboxOrderRepository {
  /**
   * 这个组织**全部**已存过的排序值，`(kind,id)` → `sort_order`。
   * 全量读而不是按一批 id 查——收件箱一次聚合本来就要给全部条目算 `boardOrder`
   * （见契约 `InboxItem.boardOrder` 头注），量级与 `listInbox` 聚合的其余两源同级。
   */
  getOrders(): Promise<ReadonlyMap<string, number>>;
  /**
   * 批量 upsert。⚠ 只写传入的这些条目，**不删除**未出现在 `entries` 里的既有行——
   * 见契约 `reorderInboxItem` 头注：漏传的 id 保留原值不动。
   */
  setOrders(entries: readonly InboxOrderEntry[]): Promise<void>;
}

export interface InboxOrderRepositoryFactory {
  forOrg(orgId: string): InboxOrderRepository;
}
