/**
 * issue #2075（TW-P2-6「对话列表要有置顶」）—— 置顶对话的本地持久化。
 *
 * ## ⚠ 为什么是浏览器本地，而不是服务端（如实登记，不是偷懒）
 *
 * 服务端**今天做不到**，这是契约事实不是猜测：`chat.operations.mutateThread.in.op`
 * 是封闭枚举 `create | rename | delete`，`ThreadCard` 也没有任何 pin/order 字段。
 * 让「置顶」落到服务端 = 新增契约字段 + 新增 mutation op + 迁移，属于**需要人类
 * 签核**的契约变更，而本 issue 的整段范围就是「不需要签核、不依赖后端新能力」那批。
 *
 * 所以这里落在 `localStorage`：它是一个**真的会生效、真的会持久**的行为——刷新后
 * 仍然置顶，不是一个点了没用的假按钮。代价是**按浏览器隔离**，换一台设备置顶不跟随。
 * 这个代价被明确写在界面提示与 issue 里，不假装它是全局的。
 *
 * 需要跨设备时的正解是把它升成契约字段——那条路记在 issue #2068 的实施清单里，
 * 不在这里用「同步到某个别的表」之类的旁路偷偷实现（那才是本仓反复栽的
 * 「同一事实声明在两处」）。
 */

const STORAGE_KEY = "workspacex.chat.pinned-threads.v1";

/** SSR 与隐私模式下 `localStorage` 不可用；读不到就当作「没有置顶」，不抛错。 */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPinnedThreadIds(): readonly string[] {
  const store = storage();
  if (store === null) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    // 存的东西被别的版本/别的手写坏了：当作空，不要让一条坏记录把左栏打死。
    return [];
  }
}

/** 切换一条对话的置顶态，返回**切换后**的完整列表（调用方直接拿去 setState）。 */
export function togglePinnedThreadId(threadId: string): readonly string[] {
  const current = readPinnedThreadIds();
  const next = current.includes(threadId)
    ? current.filter((id) => id !== threadId)
    : [threadId, ...current];
  const store = storage();
  if (store !== null) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 配额满/隐私模式：本次会话内仍然生效（返回值已经是新列表），只是不持久。
    }
  }
  return next;
}
