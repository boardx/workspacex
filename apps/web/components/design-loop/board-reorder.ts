/**
 * UC-17.8——运营收件箱看板「列内排序 + 归档」的纯逻辑，从 `inbox-screen.tsx` 拆出来
 * （该文件已接近 2000 行，AGENTS.md 文件规模纪律）。**没有 IO**：这里只做数组重排与
 * 一条可见性判定，真正的 API 调用仍在 `inbox-screen.tsx` 里（乐观更新 + 失败回滚的
 * 交互节奏和其余卡片操作一致，拆出去反而要跨文件传一堆 state setter）。
 *
 * ## 排序落库的唯一事实源
 *
 * `InboxItem.boardOrder` 与 `operations.reorderInboxItem` 见
 * `packages/contracts/src/inbox.ts`。本文件不重新发明字段含义，只把
 * 「数组现在长什么样」翻译成「服务端要落库的那份新顺序」。
 */
import type { InboxItem, InboxKind } from "@/lib/live-inbox";

/** 排序用到的最小字段集——比 `InboxItem` 窄，方便单测不用拼一整条假条目。 */
export interface BoardOrderable {
  readonly id: string;
  readonly kind: InboxKind;
  readonly boardOrder: number;
  readonly createdAt: string;
}

/**
 * 列内展示顺序：`boardOrder` 升序；相同值（理论上只有默认值撞车才会发生）按
 * `createdAt` 倒序兜底——与服务端「没排过序时越新越靠前」的默认序一致。
 */
export function compareByBoardOrder(a: BoardOrderable, b: BoardOrderable): number {
  if (a.boardOrder !== b.boardOrder) return a.boardOrder - b.boardOrder;
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt > b.createdAt ? -1 : 1;
}

export function sortByBoardOrder<T extends BoardOrderable>(items: readonly T[]): T[] {
  return [...items].sort(compareByBoardOrder);
}

/**
 * 把 `movingId` 挪到 `ids`（当前列顺序,不含 `movingId` 以外的重复项）里紧挨在
 * `beforeId` 之前；`beforeId === null` 或找不到 ⇒ 挪到列尾（拖到列的空白处 /
 * 拖到最后一张卡片之后都是这个语义）。
 */
export function reorderIds(ids: readonly string[], movingId: string, beforeId: string | null): string[] {
  const rest = ids.filter((id) => id !== movingId);
  const idx = beforeId === null ? -1 : rest.indexOf(beforeId);
  if (idx === -1) return [...rest, movingId];
  return [...rest.slice(0, idx), movingId, ...rest.slice(idx)];
}

/**
 * ↑/↓ 按钮——拖拽的非拖拽等价操作（B6.5）：与相邻一项交换位置。
 * 已经在列首/列尾时原样返回**同一个数组引用不保证**，但内容不变——调用方按
 * "新旧顺序是否相同"判断要不要真的发请求（不对已经到边界的按钮单独加 disabled 之外的特殊路径）。
 */
export function moveAdjacent(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const idx = ids.indexOf(id);
  if (idx === -1) return [...ids];
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= ids.length) return [...ids];
  const next = [...ids];
  const tmp = next[idx]!;
  next[idx] = next[swapWith]!;
  next[swapWith] = tmp;
  return next;
}

/**
 * 归档按钮的显示条件（人类原话，见任务描述）：**只对 feedback 类**、且当前
 * `sourceStatus` 是「已修复」或「不做」——状态机（`product-feedback.ts` 的
 * `ALLOWED_TRANSITIONS`）只允许从这两个状态进入「已归档」，系统异常/设计方案没有
 * 「已归档」这个状态，待处理/已进入迭代 直接归档不合法。
 */
export function canArchiveInboxItem(item: Pick<InboxItem, "kind" | "sourceStatus">): boolean {
  return item.kind === "feedback" && (item.sourceStatus === "已修复" || item.sourceStatus === "不做");
}
