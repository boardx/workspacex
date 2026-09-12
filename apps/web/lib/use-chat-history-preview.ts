import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { PersistedMessage } from "./copilotkit-v2-persisted-messages";

type PreviewAgent = Pick<AbstractAgent, "messages" | "setMessages">;
type Snapshot = { messages: PersistedMessage[]; savedAt: number };
const snapshots = new Map<string, Snapshot>();
let activeScope: string | null = null;
const MAX_AGE = 60_000;

/** Memory-only presentation cache. Never supplies write permissions or crosses identity scopes. */
export function useChatHistoryPreview(scope: string | null, threadId: string | null, agent: PreviewAgent,
  ready: boolean, setLoading: (value: boolean) => void) {
  if (activeScope !== scope) { snapshots.clear(); activeScope = scope; }
  const key = scope && threadId ? JSON.stringify([scope, threadId]) : null;
  const previewed = React.useRef<Snapshot | null>(null);
  React.useLayoutEffect(() => {
    const snapshot = key ? snapshots.get(key) : undefined;
    if (!ready || !snapshot || Date.now() - snapshot.savedAt > MAX_AGE || agent.messages.length) return;
    agent.setMessages(snapshot.messages.map(({ id, role, content }) => ({ id, role, content })));
    previewed.current = snapshot;
    setLoading(false);
  }, [key, ready, agent, setLoading]);
  const remember = React.useCallback((messages: PersistedMessage[]) => {
    if (!key || activeScope !== scope) return;
    snapshots.delete(key);
    snapshots.set(key, { messages, savedAt: Date.now() });
    if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!);
  }, [key, scope]);
  const discard = React.useCallback(() => {
    if (key) snapshots.delete(key);
    if (previewed.current) {
      const cached = previewed.current.messages;
      agent.setMessages(agent.messages.filter(message => !cached.some(old => old.id === message.id
        && old.role === message.role && old.content === message.content)));
      previewed.current = null;
    }
  }, [key, agent]);
  return { remember, discard };
}
