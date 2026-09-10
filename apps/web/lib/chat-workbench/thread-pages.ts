/**
 * issue #3356 —— 对话列表「翻页」的**纯函数**部分。
 *
 * ## 单一事实源
 *
 * 「还有没有下一页」只有一个事实源：服务端返回的 `nextCursor`
 * （`null` = 没有了）。前端**不**维护「当前第几页」「还剩多少条」「是不是已经到底」
 * 这些平行状态——它们全部从手上这一份 `ListPersonalThreadsOut` 读出来：
 *
 *   · 还能不能加载更多 ⇒ `hasMorePages(list)`（读的就是 `list.nextCursor`）
 *   · 下一页从哪继续   ⇒ `list.nextCursor`（原样回传，不解析）
 *   · 已经加载了多少   ⇒ `countCards(list)`
 *
 * 本仓头号病是「同一事实声明在两处」（已十二例）。分页最容易犯的那一版是：
 * 前端记一个 `page` 计数器、再用「这一页回来了几条 === limit」推一个 `hasMore`。
 * 那两份都会错——可见性过滤会让一页返回的卡片数**少于** limit 而后面仍有数据。
 *
 * ## 为什么合并逻辑在这里，而不在组件里
 *
 * 「把新一页并进已加载的列表」有三条不能错的规则（组内追加、不重复、组顺序不变），
 * 每一条都是分页边界最容易出错的地方。放在纯函数里才写得出针对边界的单元测试；
 * 埋在 `copilotkit-v2-shell.tsx`（1200+ 行、多个在途 issue 并发触碰）里只能靠 e2e 撞。
 */
import { chat as C } from "@repo/contracts";
import type { ListPersonalThreadsOut } from "@/lib/live-chat";

/** 一页几条——引用契约里那个唯一常量，不在前端再写一个 30。 */
export const THREAD_PAGE_SIZE = C.THREAD_PAGE_SIZE;

/** 保鲜刷新一次最多要回多少条，见下面 `refreshLimit`。与契约 `limit` 的上限一致。 */
const REFRESH_LIMIT_CAP = 300;

export function countCards(list: ListPersonalThreadsOut | null): number {
  if (list === null) return 0;
  return list.groups.reduce((sum, group) => sum + group.cards.length, 0);
}

/** 还能不能「加载更多」。**唯一判据**就是服务端给的游标。 */
export function hasMorePages(list: ListPersonalThreadsOut | null): boolean {
  // ⚠ 判 `typeof === "string"` 而不是 `!== null`：字段**缺失**（旧响应体、
  //   替身夹具、项目对话那条不分页的链路）必须与「没有下一页」同解。判 `!== null`
  //   会让 `undefined` 变成"还有更多"，于是画出一个点了永远拿不到东西的按钮。
  return list !== null && typeof list.nextCursor === "string" && list.nextCursor !== "";
}

/**
 * 把**下一页**并进已加载的列表。
 *
 * ⚠ 按 `label` 并到同名组里，不是简单地把两个 `groups` 数组接起来——否则一次
 *   横跨「本周 / 更早」边界的翻页会让「更早」这个组头在列表里**出现两次**
 *   （第一页尾部一段、第二页头部又一段）。分组是服务端的事实（`threadGroupLabel`），
 *   前端只负责把同一个 label 的卡片放在一起。
 * ⚠ 组的**顺序以已加载的那份为准**，新出现的组按新页里的顺序追加在后面。服务端
 *   恒按 `THREAD_GROUP_ORDER` 下发，所以这两件事等价；写成"以已加载的为准"是为了
 *   即使服务端顺序变了，用户眼前的列表也不会在一次「加载更多」之后整体重排。
 * ⚠ 按 id 去重是**兜底**，不是主要防线：游标分页本身保证不重复（见
 *   `apps/api/src/domain/chat/thread-list-cursor.ts`）。留着它是因为"重复渲染
 *   同一条对话"在 React 里会变成 duplicate key 警告 + 点错行，代价远大于一次 Set 查询。
 * ⚠ `nextCursor` 取**新一页的**：它描述的是"合并之后这份列表的末尾在哪"。
 *   取旧的会让「加载更多」永远停在同一页。
 */
export function appendThreadPage(
  loaded: ListPersonalThreadsOut,
  page: ListPersonalThreadsOut,
): ListPersonalThreadsOut {
  const seen = new Set(loaded.groups.flatMap((group) => group.cards.map((card) => card.id)));
  const merged = loaded.groups.map((group) => ({ ...group, cards: [...group.cards] }));

  for (const incoming of page.groups) {
    const fresh = incoming.cards.filter((card) => !seen.has(card.id));
    for (const card of fresh) seen.add(card.id);
    if (fresh.length === 0) continue;
    const existing = merged.find((group) => group.label === incoming.label);
    if (existing) existing.cards.push(...fresh);
    else merged.push({ label: incoming.label, cards: fresh });
  }

  return {
    groups: merged,
    // 能力集合与"翻到第几页"无关，取新的一份（服务端每页都恒下发同一个集合）。
    capabilities: page.capabilities,
    nextCursor: page.nextCursor ?? null,
  };
}

/**
 * 保鲜刷新（每 10 秒 + 窗口回焦）要请求多少条。
 *
 * 刷新总是**从头开始**（不带 cursor）——它要的是"最新的状态"，而最新的状态天然
 * 从列表顶部长出来。但它不能只要 30 条：用户已经点了三次「加载更多」的话，
 * 一次 30 条的刷新会把他翻出来的 90 条**缩回 30 条**，看起来像列表自己塌了。
 *
 * 所以刷新请求「用户目前已经看到的那么多」，向上取整到整页，并封顶
 * `REFRESH_LIMIT_CAP`。封顶不是为了省事：没有上限的话，翻得足够深之后每 10 秒
 * 就是一次全量拉取——正是这个 issue 要删掉的行为，只不过换了个触发点。
 * 翻得比上限还深时，刷新只覆盖前 300 条，再往下的部分保留上一次的结果。
 */
export function refreshLimit(loaded: ListPersonalThreadsOut | null): number {
  const loadedCount = countCards(loaded);
  if (loadedCount <= THREAD_PAGE_SIZE) return THREAD_PAGE_SIZE;
  const wholePages = Math.ceil(loadedCount / THREAD_PAGE_SIZE) * THREAD_PAGE_SIZE;
  return Math.min(REFRESH_LIMIT_CAP, wholePages);
}
