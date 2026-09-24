/**
 * phase-18 F15（06-UX R4 E4「引用点开就是原话，且原话被高亮」/ R3-6「来源永远一跳可达」）——
 * 来源抽屉的「跳到原消息」：把对话里那条消息滚到眼前并高亮。
 *
 * - 对话里每条用户消息的正文带 `data-kg-message-id`（落库后的真实 id，见 `copilotkit-v2-user-message.tsx`）；
 * - 同一个对话里、那条消息已经在界面上 ⇒ 就地滚动 + 高亮；
 * - 在别的对话里（长期记忆的原话、另一个会话），或刚发的消息界面上还是临时 id ⇒ 打开
 *   `/chat/<会话>?focusMessage=<id>`，那边加载完消息后由 `useFocusMessageFromUrl` 高亮。
 * 链接的拼法与读法只在这一处（同 `chat-memory-link.ts` 的纪律）。
 */
import * as React from "react";

export const FOCUS_MESSAGE_PARAM = "focusMessage";
export const MESSAGE_ANCHOR_ATTR = "data-kg-message-id";
export const SOURCE_HIGHLIGHT_ATTR = "data-kg-source-highlight";
/** 高亮的样子：一圈主色描边（ring = box-shadow），不只是颜色深浅，一眼看得出是「这一条」。 */
const HIGHLIGHT_CLASSES = ["rounded-md", "ring-2", "ring-ring", "ring-offset-4", "ring-offset-background"];

export function focusMessageHref(input: { threadId: string; messageId: string; projectId?: string | null }): string {
  const q = new URLSearchParams();
  if (input.projectId) q.set("projectId", input.projectId);
  q.set(FOCUS_MESSAGE_PARAM, input.messageId);
  return `/chat/${encodeURIComponent(input.threadId)}?${q.toString()}`;
}

export function readFocusMessage(search: string): string | null {
  const raw = new URLSearchParams(search).get(FOCUS_MESSAGE_PARAM);
  return raw === null || raw === "" ? null : raw;
}

/** 就地高亮这条消息（同一时刻只高亮一条）；界面上没有它 ⇒ false。 */
export function highlightChatMessage(messageId: string, root: ParentNode = document): boolean {
  const target = [...root.querySelectorAll<HTMLElement>(`[${MESSAGE_ANCHOR_ATTR}]`)]
    .find((el) => el.getAttribute(MESSAGE_ANCHOR_ATTR) === messageId);
  if (target === undefined) return false;
  for (const prev of root.querySelectorAll<HTMLElement>(`[${SOURCE_HIGHLIGHT_ATTR}]`)) {
    prev.removeAttribute(SOURCE_HIGHLIGHT_ATTR);
    prev.classList.remove(...HIGHLIGHT_CLASSES);
  }
  target.setAttribute(SOURCE_HIGHLIGHT_ATTR, "true");
  target.classList.add(...HIGHLIGHT_CLASSES);
  target.scrollIntoView?.({ block: "center" });
  return true;
}

/** 打开对话时带着 `?focusMessage=` ⇒ 等那条消息出现在界面上（历史是异步加载的），高亮它。最多等 15 秒。 */
export function useFocusMessageFromUrl(threadId: string | null): void {
  const handled = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (threadId === null || typeof window === "undefined") return undefined;
    const messageId = readFocusMessage(window.location.search);
    const key = `${threadId}:${messageId ?? ""}`;
    if (messageId === null || handled.current === key) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (highlightChatMessage(messageId)) handled.current = key;
      if (handled.current === key || Date.now() - started > 15_000) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [threadId]);
}
