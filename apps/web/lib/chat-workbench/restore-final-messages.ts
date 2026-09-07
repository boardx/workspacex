import type { AbstractAgent } from "@ag-ui/client";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { PersistedMessage } from "@/lib/copilotkit-v2-persisted-messages";
type RuntimeMessage = AbstractAgent["messages"][number];
/** Replace final identities proven by the journal or persisted identity mapping, leaving other turns intact. */
export function restoreFinalMessages(current: readonly RuntimeMessage[], events: readonly ExecutionEvent[], restored: readonly PersistedMessage[], resolvePersisted: (id: string) => string | null = () => null): RuntimeMessage[] {
  const finalIds = new Set(events.filter((event) => event.kind === "final_message").map((event) => event.messageId));
  const persistedIds = new Set(restored.map((message) => message.id));
  return [...current.filter((message) => !finalIds.has(message.id) && !persistedIds.has(message.id) && !persistedIds.has(resolvePersisted(message.id) ?? "")),
    ...restored.map((message) => ({ id: message.id, role: message.role, content: message.content }))];
}
