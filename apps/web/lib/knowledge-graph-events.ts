/**
 * phase-18 F09/F10 —— 消息流（回答下「已记下 N 条」）与右栏「记忆」页签之间的三根线。
 *
 * 走 window 事件 / 模块级小 store 而不是 Context，理由与 `lib/chat-workbench/panel-document.ts`
 * 相同：回答画在消息流里、右栏 `ChatTaskInspector` 是另一棵子树，中间隔着 `copilotkit-v2-shell`，
 * 两边在多份单测里各自被 mock。**记忆读模型只有一份**，活在 inspector 的 `useThreadKnowledge` 里：
 *   ① `requestOpenKnowledgePanel`：「查看」→ 切到「记忆」页签并展开右栏。
 *   ② `requestKnowledgeReload`：回答下「撤销」成功后 → 让那一份读模型重读（面板与角标一起更新）。
 *   ③ 快照 `{ threadId, canEdit, revision }`：读模型每次读到就发布，回答下的「撤销」据此决定
 *      渲不渲染（只有所有者）以及带哪个 `basedOnRevision`。
 *   ④ `requestOpenClaimSources`（F13）：回答下的引用 chip → 切到「记忆」页签并打开那一条的来源抽屉。
 *   ⑤ `requestRememberStatement`（F17 手动入口，issue #4179）：消息 hover 菜单「记住这句」/
 *      记忆面板「+ 记一条」→ 把一句话交给 F17 已有的「记住」确认卡路径。同一条线，
 *      不新增契约操作：订阅方（`copilotkit-v2-panel-body.tsx` 的 `send()`）把它当一条
 *      新的聊天消息发出去（加「记住：」前缀），走既有的 `detectMemoryIntent` →
 *      `cards.open` → 确认卡（`domain/knowledge-graph/memory-intent.ts`）。**这里只是
 *      请求，从不直接写入**——是否真的记住仍由随后出现的确认卡上的人工点击决定。
 */
import * as React from "react";

export const OPEN_KNOWLEDGE_PANEL_EVENT = "chat:open-knowledge-panel";
export const RELOAD_KNOWLEDGE_EVENT = "chat:reload-knowledge";

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

/**
 * F13 —— 回答下点一条引用 chip：打开那一条的来源抽屉（抽屉活在右栏记忆面板里）。
 *
 * 面板只在「记忆」页签选中时挂载，点 chip 那一刻它可能还不存在。所以请求分两步：
 *   · 先记下「待打开的 claimId」（模块级，一次只有一条，后点的覆盖先点的）；
 *   · 再发 `OPEN_CLAIM_SOURCES_EVENT`：inspector 据此切页签；已挂载的面板据此立刻取走并打开。
 * 面板挂载时也取一次（`takePendingClaimSources`），接住「点击时还没挂载」的那一次。取走即清空，
 * 不会在下次打开面板时又弹一次旧抽屉。
 */
export const OPEN_CLAIM_SOURCES_EVENT = "chat:open-claim-sources";

let pendingClaimSourcesId: string | null = null;

export function requestOpenClaimSources(claimId: string): void {
  if (typeof window === "undefined" || claimId === "") return;
  pendingClaimSourcesId = claimId;
  window.dispatchEvent(new CustomEvent<string>(OPEN_CLAIM_SOURCES_EVENT, { detail: claimId }));
}

/** 取走待打开的 claimId（取走即清空）；没有时为 null。 */
export function takePendingClaimSources(): string | null {
  const id = pendingClaimSourcesId;
  pendingClaimSourcesId = null;
  return id;
}

/** 订阅「要打开某条来源」。handler 收到 claimId；要不要取走由订阅方决定。 */
export function onOpenClaimSources(handler: (claimId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string" && detail !== "") handler(detail);
  };
  window.addEventListener(OPEN_CLAIM_SOURCES_EVENT, listener);
  return () => { window.removeEventListener(OPEN_CLAIM_SOURCES_EVENT, listener); };
}

/**
 * F17 手动入口（issue #4179）：「记住这句」（消息 hover 菜单）/「+ 记一条」（记忆面板）共用同一个请求。
 * `statement` 就是要记的那句话本身（用户自己发的消息全文，或面板里手打的文字）——「记住：」前缀
 * 由订阅方加，这里只传纯内容，避免两处各自拼一次前缀、字面不一致。空白（trim 后）不发。
 */
export const REMEMBER_STATEMENT_EVENT = "chat:remember-statement";

export function requestRememberStatement(statement: string): void {
  const trimmed = statement.trim();
  if (typeof window === "undefined" || trimmed === "") return;
  window.dispatchEvent(new CustomEvent<string>(REMEMBER_STATEMENT_EVENT, { detail: trimmed }));
}

/** 订阅「有一句话要走记住流程」。handler 收到已 trim 过的纯文本（不带「记住：」前缀）。 */
export function onRememberStatement(handler: (statement: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string" && detail !== "") handler(detail);
  };
  window.addEventListener(REMEMBER_STATEMENT_EVENT, listener);
  return () => { window.removeEventListener(REMEMBER_STATEMENT_EVENT, listener); };
}

export function requestKnowledgeReload(threadId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(RELOAD_KNOWLEDGE_EVENT, { detail: threadId }));
}

export function onKnowledgeReload(handler: (threadId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string" && detail !== "") handler(detail);
  };
  window.addEventListener(RELOAD_KNOWLEDGE_EVENT, listener);
  return () => { window.removeEventListener(RELOAD_KNOWLEDGE_EVENT, listener); };
}

export interface KnowledgeSnapshot {
  readonly threadId: string;
  readonly canEdit: boolean;
  readonly revision: number;
}

let snapshot: KnowledgeSnapshot | null = null;
const listeners = new Set<() => void>();

export function publishKnowledgeSnapshot(next: KnowledgeSnapshot | null): void {
  if (
    snapshot === next ||
    (snapshot !== null && next !== null && snapshot.threadId === next.threadId &&
      snapshot.canEdit === next.canEdit && snapshot.revision === next.revision)
  ) return;
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** 这条线程最近一次读到的快照；不是这条线程（或还没读到）时为 null。 */
export function useKnowledgeSnapshot(threadId: string): KnowledgeSnapshot | null {
  const current = React.useSyncExternalStore(subscribe, () => snapshot, () => null);
  return current !== null && current.threadId === threadId ? current : null;
}
