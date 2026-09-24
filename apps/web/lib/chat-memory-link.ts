/**
 * 从别处（大脑页）直达某个对话的「记忆」页签——链接的拼法与读法只在这一处。
 *
 * - `?memory=1`：打开对话后切到右栏「记忆」页签。
 * - `?memory=<记下的那一条的 id>`：同上，并打开这一条的来源抽屉（看它出自哪句原话）。
 *
 * 项目对话要带 `projectId`（同 `/chat` 路由的既有约定，见 `copilotkit-v2-shell-route.tsx`）。
 */
export const CHAT_MEMORY_PARAM = "memory";

export function chatMemoryHref(input: { threadId: string; projectId: string | null; claimId?: string | null }): string {
  const q = new URLSearchParams();
  if (input.projectId !== null) q.set("projectId", input.projectId);
  q.set(CHAT_MEMORY_PARAM, input.claimId ?? "1");
  return `/chat/${encodeURIComponent(input.threadId)}?${q.toString()}`;
}

/** 读链接里的请求：没有 ⇒ null；只要打开页签 ⇒ `{ claimId: null }`；要打开某条来源 ⇒ `{ claimId }`。 */
export function readChatMemoryRequest(search: string): { claimId: string | null } | null {
  const raw = new URLSearchParams(search).get(CHAT_MEMORY_PARAM);
  if (raw === null || raw === "") return null;
  return { claimId: raw === "1" ? null : raw };
}
