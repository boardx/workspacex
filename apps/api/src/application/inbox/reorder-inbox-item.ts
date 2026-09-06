/**
 * `reorderInboxItem` —— UC-17.8「列内可上下移动/拖拽排序」，契约见
 * `packages/contracts/src/inbox.ts` 的同名操作头注（那里是唯一的语义权威，
 * 这里只落地）。
 */
import { assignBoardOrders, type BoardOrderEntry } from "../../domain/inbox/board-order";
import type { InboxOrderRepository } from "./inbox-order.port";
import { InboxPermissionRevokedError } from "./list-inbox";

export { InboxPermissionRevokedError };

export interface ReorderInboxItemDeps {
  readonly orders: InboxOrderRepository;
}

export interface ReorderInboxItemInput {
  /** `null` ⟺ 不是本组织成员——同 `listInbox`/`getInboxCounts` 的门（D8 ③）。 */
  readonly viewerOrgRole: string | null;
  readonly stage: string;
  readonly orderedIds: readonly BoardOrderEntry[];
}

export interface ReorderInboxItemResult {
  readonly stage: string;
  readonly count: number;
}

export async function reorderInboxItem(
  deps: ReorderInboxItemDeps,
  input: ReorderInboxItemInput,
): Promise<ReorderInboxItemResult> {
  // 排序不是分诊——不要求 `canTriage`（管理员），只要求「打得开这个看板」这条门，
  // 与 `listInbox` 同一条纪律（见契约 `inbox.ts` 头注「谁能打开收件箱」）。
  if (input.viewerOrgRole === null) throw new InboxPermissionRevokedError();

  const assignment = assignBoardOrders(input.orderedIds);
  const entries = [...assignment.entries()].map(([key, order]) => {
    const idx = key.indexOf(":");
    return {
      kind: key.slice(0, idx) as BoardOrderEntry["kind"],
      id: key.slice(idx + 1),
      order,
    };
  });
  await deps.orders.setOrders(entries);
  return { stage: input.stage, count: entries.length };
}
