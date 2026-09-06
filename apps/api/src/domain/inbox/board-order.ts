/**
 * UC-17.8——收件箱看板「列内排序」的**领域规则**（纯函数，无 IO、无框架）。
 *
 * 契约：`packages/contracts/src/inbox.ts` 的 `operations.reorderInboxItem`。
 * 这里落契约表达不了的东西：`orderedIds`（一列的完整新顺序）→ 每个条目该落库的
 * `sort_order` 整数值，含**去重**（同一个 `{kind,id}` 出现两次只认第一次出现的位置——
 * 一个请求体里出现重复项没有"两个位置都要"的合理语义，去重比报错更不容易在前端
 * 一次无害的重渲染下把整条请求打回）。
 */

/** `InboxKind` 的字面量——不从契约 import 是为了不让 domain 依赖 zod 的类型推导链，
 *  这里只需要"是个字符串闭集"这件事；真正的闭集校验已经在契约层做过一次。 */
export type BoardOrderKind = "feedback" | "exception" | "design";

export interface BoardOrderEntry {
  readonly kind: BoardOrderKind;
  readonly id: string;
}

/** `(kind, id)` → 复合键，`inbox_item_order` 的主键形状在应用层就用这同一个函数拼。 */
export function boardOrderKey(kind: BoardOrderKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * 把一列的新顺序换算成每个条目该落库的整数序号（0-based，数组下标即序号）。
 *
 * ⚠ 去重：后出现的重复项被丢弃，**不是**报错——见文件头。
 * ⚠ 返回 `Map`，key 是 `boardOrderKey(kind,id)`，调用方（应用层）据此批量 upsert。
 */
export function assignBoardOrders(entries: readonly BoardOrderEntry[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  let order = 0;
  for (const entry of entries) {
    const key = boardOrderKey(entry.kind, entry.id);
    if (out.has(key)) continue;
    out.set(key, order);
    order += 1;
  }
  return out;
}

/**
 * 一条从未被手动排过序的条目的默认序——与现有「按 `createdAt` 倒序」的展示顺序保持
 * 连续：越新的 `createdAt` 得到越小（越靠前）的默认序。**只在服务端读路径用**，
 * 不落库——一旦条目被真的排过序，`inbox_item_order` 里的值优先于这个默认值。
 */
export function defaultBoardOrder(createdAtIso: string): number {
  return -new Date(createdAtIso).getTime();
}
