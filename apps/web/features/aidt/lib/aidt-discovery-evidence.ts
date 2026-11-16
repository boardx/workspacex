import { chat } from "@repo/contracts";
import { getThread, listMessages } from "@/lib/live-chat";
import { isAidtModuleEnabled } from "./aidt-module-config";
import { AidtDiscoverySourceSchema, boundAidtDiscoverySource } from "./aidt-discovery-source-reference";
export * from "./aidt-discovery-source-reference";

/** Only reads authorized human messages. Agent responses cannot become interview originals. */
export async function loadAidtDiscoverySources(input: { projectId: string; threadId: string; sessionToken: string; cursor?: string; signal?: AbortSignal }) {
  const current = () => { if (!isAidtModuleEnabled() || input.signal?.aborted) throw new Error("AIDT_CONTEXT_CHANGED"); };
  current();
  const detail = await getThread(input.threadId, input.projectId, input.sessionToken); current();
  if (detail.thread.id !== input.threadId || detail.thread.projectId !== input.projectId || detail.thread.visibilityScope !== "plenary" || detail.thread.groupId !== null) throw new Error("AIDT_SOURCE_UNAVAILABLE");
  const result = chat.operations.listMessages.out.parse(await listMessages(input.threadId, { limit: 100, cursor: input.cursor }, input.sessionToken)); current();
  const seen = new Set<string>();
  return { nextCursor: result.nextCursor, items: result.messages.filter(message => {
    if (message.authorKind !== "human" || !message.text.trim() || !message.id || !message.authorId || seen.has(message.id)) return false;
    seen.add(message.id); return true;
  }).map(message => boundAidtDiscoverySource(AidtDiscoverySourceSchema.parse({ projectId: input.projectId, threadId: input.threadId, messageId: message.id, authorId: message.authorId, createdAt: message.createdAt, text: message.text.slice(0, 4000), truncated: message.text.length > 4000 }))) };
}
