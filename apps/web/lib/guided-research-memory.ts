import { getStoredSessionToken } from "./api-client";
import type { GuidedResearchRuntime } from "./guided-research-api";

// Page-memory only: a reload starts empty. Never share state between credentials.
let owner: string | null = null;
const sessions = new Map<string, { runtime?: GuidedResearchRuntime; name?: string }>();
function current(scope: string | null) {
  const token = getStoredSessionToken();
  if (owner !== token) { sessions.clear(); owner = token; }
  return Boolean(scope && scope === token);
}
export function readResearchMemory(sessionId: string, scope = getStoredSessionToken()) {
  return current(scope) ? sessions.get(sessionId) : undefined;
}
export function writeResearchMemory(sessionId: string, value: { runtime?: GuidedResearchRuntime; name?: string }, scope: string | null) {
  if (!current(scope)) return;
  const old = sessions.get(sessionId);
  sessions.delete(sessionId);
  sessions.set(sessionId, { ...old, ...value });
  // Bound detached sessions; the durable API remains the recovery authority.
  while (sessions.size > 3) sessions.delete(sessions.keys().next().value!);
}
