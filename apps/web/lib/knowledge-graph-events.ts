/**
 * phase-18 F09 —— 「打开右栏的记忆面板」触发点（回答下「已记下 N 条 · 查看」→ 右栏「记忆」页签）。
 *
 * 走 window 事件而不是 Context，理由与 `lib/chat-workbench/panel-document.ts` 相同：
 * 回答画在消息流里、右栏 `ChatTaskInspector` 是另一棵子树，中间隔着 `copilotkit-v2-shell`，
 * 两边在多份单测里各自被 mock。事件让「谁发起」与「谁持有状态」解耦——**面板状态只有一份**，
 * 活在 inspector 的「记忆」页签里。
 */
export const OPEN_KNOWLEDGE_PANEL_EVENT = "chat:open-knowledge-panel";

export function requestOpenKnowledgePanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_KNOWLEDGE_PANEL_EVENT));
}

/** 订阅。返回取消订阅函数。 */
export function onOpenKnowledgePanel(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (): void => handler();
  window.addEventListener(OPEN_KNOWLEDGE_PANEL_EVENT, listener);
  return () => { window.removeEventListener(OPEN_KNOWLEDGE_PANEL_EVENT, listener); };
}
