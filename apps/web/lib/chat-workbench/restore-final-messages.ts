import type { AbstractAgent } from "@ag-ui/client";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { PersistedMessage } from "@/lib/copilotkit-v2-persisted-messages";
type RuntimeMessage = AbstractAgent["messages"][number];
/**
 * Replace final identities proven by the journal or persisted identity mapping, leaving other turns intact.
 *
 * ⚠ issue #3399 ① —— 顶替是**就地**发生的，不是"摘掉再追加到队尾"。
 *
 * 时间线里唯一正确的排序是**发送时刻**：T 时刻出现的东西，必须排在 T 之前已经存在的
 * 全部内容之下。run 收尾时把本轮正文重新挂到队尾，就会把 run 期间追加进来的消息
 * （插话气泡是最常见的一种——用户在正文流完之后才发的那句话）顶到正文**上方**，
 * 用户去消息流底部找自己刚发的话找不到（2026-09-11 devapp 人类实测）。
 *
 * 所以：落库正文接管被顶替消息中**最靠前**的那个位置，其余消息保持原有相对顺序。
 * 这样反复收敛是幂等的——第二次进来时落库正文本身就在那个位置上。
 */
export function restoreFinalMessages(current: readonly RuntimeMessage[], events: readonly ExecutionEvent[], restored: readonly PersistedMessage[], resolvePersisted: (id: string) => string | null = () => null): RuntimeMessage[] {
  const finalIds = new Set(events.filter((event) => event.kind === "final_message").map((event) => event.messageId));
  const persistedIds = new Set(restored.map((message) => message.id));
  const replaced = (message: RuntimeMessage) =>
    finalIds.has(message.id) || persistedIds.has(message.id) || persistedIds.has(resolvePersisted(message.id) ?? "");
  const kept: RuntimeMessage[] = [];
  let insertAt: number | null = null;
  for (const message of current) {
    if (replaced(message)) { insertAt ??= kept.length; continue; }
    kept.push(message);
  }
  const incoming = restored.map((message) => ({ id: message.id, role: message.role, content: message.content }));
  const at = insertAt ?? kept.length;
  return [...kept.slice(0, at), ...incoming, ...kept.slice(at)];
}
