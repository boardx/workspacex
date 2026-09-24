/**
 * 「把这条结果放到右栏去看」——执行过程 → 右栏的**触发点**。
 *
 * ## 为什么需要它（2026-09-23，R11）
 *
 * 人类原话：「模范他们应该在右边可以打开结果，浏览网页等」。R2–R8 让**产物**能在右栏
 * 打开了，但**工具结果**（`fetch_url` 抓回来的网页正文、脚本输出、检索结果）仍然只活在
 * 执行过程那一列里：折叠行 → 展开 → 一个 `max-h-64` 的 `<pre>`，长正文在里面滚。
 * 一篇抓回来的网页在那个格子里是没法读的，更别说边读边追问。
 *
 * ## 为什么走 window 事件而不是 Context
 *
 * 与 `lib/shell-panel-events.ts` 同一条理由（见其文件头注）：执行过程画在消息流里、
 * 右栏是另一棵子树，中间隔着 `copilotkit-v2-shell`；而这两处在多份单测里各自被 mock。
 * 事件让「谁发起」与「谁持有状态」解耦——单测可以只断言事件发出，也可以让真实的
 * inspector 接住。**状态仍然只有一份**，活在 `ChatTaskInspector` 的页签里。
 */

/** 右栏能显示的一份「文档」。目前只有工具结果一种；产物走它自己的取源路径。 */
export interface PanelResultDocument {
  /** 稳定 id：同一条工具调用重复点「在右栏打开」只切过去，不开第二个页签。 */
  readonly id: string;
  readonly title: string;
  /** 结果正文。已经是字符串的才会被送过来——JSON 结果留在「技术细节」里。 */
  readonly text: string;
  /** 这条调用访问的地址（如果有），详情里给一条可点外链。已由 `externalHttpUrl` 判过。 */
  readonly url: string | null;
}

export const OPEN_IN_RIGHT_PANEL_EVENT = "chat:open-in-right-panel";

export function requestOpenInRightPanel(doc: PanelResultDocument): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PanelResultDocument>(OPEN_IN_RIGHT_PANEL_EVENT, { detail: doc }));
}

/**
 * 订阅。返回取消订阅函数。
 *
 * ⚠ 事件的 `detail` 来自另一棵子树，**当作数据校验**再用：少一个字段就整条丢弃，
 * 而不是把 `undefined` 塞进页签标题里渲染成一个空白页签（那会让用户以为右栏坏了）。
 */
export function onOpenInRightPanel(handler: (doc: PanelResultDocument) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (detail === null || typeof detail !== "object") return;
    const { id, title, text, url } = detail as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof title !== "string" || typeof text !== "string") return;
    handler({ id, title, text, url: typeof url === "string" ? url : null });
  };
  window.addEventListener(OPEN_IN_RIGHT_PANEL_EVENT, listener);
  return () => { window.removeEventListener(OPEN_IN_RIGHT_PANEL_EVENT, listener); };
}
