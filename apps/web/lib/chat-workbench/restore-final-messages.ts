import type { AbstractAgent } from "@ag-ui/client";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { PersistedMessage } from "@/lib/copilotkit-v2-persisted-messages";
type RuntimeMessage = AbstractAgent["messages"][number];
/**
 * Replace final identities proven by the journal or persisted identity mapping, leaving
 * other turns intact.
 *
 * ## issue #3389 —— **权威读与在途正文说的是同一句话时，这里必须无事可做**
 *
 * 本函数原来无条件地「把流式那条气泡从列表里摘掉、把落库那条追加到末尾」。当两者的
 * 正文**逐字相同**时，那次替换换掉的只有 React 身份：旧节点卸载、新节点挂载，
 * `chat-ai-markdown` 有一帧是空的。真栈实测（`copilotkit-v2-stream-frame-timing.spec.ts`
 * 在 chat-read 车道上的采样序列）：
 *
 * ```
 * [0, 24, 64, 104, 152, 190, 0, 190]
 *                            ↑  ↑
 *                     权威读把气泡换掉  同一段字重新画出来
 * ```
 *
 * 注意末尾那两个数**相等**——正文没有变，只是消失了一下又回来。这是 #3389 那条
 * 「同一句话有两份事实，靠抹掉一份、重画另一份对齐」在前端的第三处实例（另两处：
 * `execution-journal-relay.ts` 的 `finish()`、替身两个端点的默认模板）。
 *
 * 修法与另两处同一条：**两份事实一致时不动它**。落库那行的字节与气泡上已经显示的
 * 逐字相同 ⇒ 保留**原来那个消息对象、原来的位置、原来的 id**，不摘不追加，于是没有
 * 卸载重挂，也就没有那一帧空白。
 *
 * ⚠ 这**不是**「在重读那侧加特判去躲开在途文本」——那种特判是「看到在途文本就跳过
 * 权威读」，会让真的分叉（流被掐断、`/state` 更完整）永远修不回来。这里判的是
 * **字节是否相等**：不相等照旧原样替换（上面两条既有用例逐字盯着这条路径）。
 *
 * ⚠ 保留流式 id 不影响评分/落地：它们走的是 `copilotkit-v2-message-identity.ts` 的
 * 映射索引（`resolvePersisted`），不是消息对象自己的 id——`copilotkit-v2-roster-landing.spec.ts`
 * 正是照映射取证的。`registerHydrated` 照旧在调用方登记落库主键，不经由本函数。
 */
export function restoreFinalMessages(current: readonly RuntimeMessage[], events: readonly ExecutionEvent[], restored: readonly PersistedMessage[], resolvePersisted: (id: string) => string | null = () => null): RuntimeMessage[] {
  const finalIds = new Set(events.filter((event) => event.kind === "final_message").map((event) => event.messageId));
  const persistedIds = new Set(restored.map((message) => message.id));
  /** 这条气泡对应哪一行落库消息（自己就是主键，或经映射指向主键）；都不是则 null。 */
  const persistedIdOf = (message: RuntimeMessage): string | null => {
    if (persistedIds.has(message.id)) return message.id;
    const mapped = resolvePersisted(message.id);
    return mapped !== null && persistedIds.has(mapped) ? mapped : null;
  };
  // 已经在显示权威字节的那些气泡：保留原对象，落库那行因此无需再画一遍。
  const settled = new Map<string, RuntimeMessage>();
  for (const message of current) {
    const persistedId = persistedIdOf(message);
    if (persistedId === null || settled.has(persistedId)) continue;
    const authoritative = restored.find((candidate) => candidate.id === persistedId);
    if (authoritative !== undefined && authoritative.content === message.content) settled.set(persistedId, message);
  }
  const keep = (message: RuntimeMessage): boolean => {
    const persistedId = persistedIdOf(message);
    if (persistedId !== null && settled.get(persistedId) === message) return true;
    return !finalIds.has(message.id) && persistedId === null;
  };
  return [...current.filter(keep),
    ...restored.filter((message) => !settled.has(message.id)).map((message) => ({ id: message.id, role: message.role, content: message.content }))];
}
