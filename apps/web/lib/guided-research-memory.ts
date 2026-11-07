import { getStoredSessionToken } from "./api-client";
import type { GuidedResearchRuntimeDraft, GuidedResearchRuntime } from "./guided-research-api";

// Page-memory only: a reload starts empty. Never share state between credentials.
let owner: string | null = null;
type Memory = { runtime?: GuidedResearchRuntime; name?: string; nameRevision?: number; drafts?: Partial<Record<GuidedResearchRuntimeDraft["node"], GuidedResearchRuntimeDraft>> };
const sessions = new Map<string, Memory>();
const reads = new Map<string, { baseline?: object; request: Promise<unknown> }>();
export function getResearchMemoryScope(): string | null {
  const token = getStoredSessionToken();
  if (!token || typeof window === "undefined") return token;
  try {
    const session: unknown = JSON.parse(window.localStorage.getItem("wsx.session") ?? "null");
    if (session && typeof session === "object" && "currentOrgId" in session && typeof session.currentOrgId === "string") {
      return JSON.stringify([token, session.currentOrgId]);
    }
  } catch { /* SessionProvider owns invalid-session handling. */ }
  return token;
}
function current(scope: string | null) {
  const token = getResearchMemoryScope();
  if (owner !== token) { sessions.clear(); reads.clear(); owner = token; }
  return Boolean(scope && scope === token);
}
export function readResearchMemory(sessionId: string, scope = getResearchMemoryScope()) {
  return current(scope) ? sessions.get(sessionId) : undefined;
}
export function writeResearchMemory(sessionId: string, value: Memory, scope: string | null) {
  if (!current(scope)) return;
  const old = sessions.get(sessionId);
  sessions.delete(sessionId);
  sessions.set(sessionId, { ...old, ...value, ...(value.name !== undefined ? { nameRevision: (old?.nameRevision ?? 0) + 1 } : {}) });
  // Bound detached sessions; the durable API remains the recovery authority.
  while (sessions.size > 3) sessions.delete(sessions.keys().next().value!);
}

// Deduplicate only concurrent reads, never cache a settled validation response.
export function readResearchOnce<T>(sessionId: string, kind: string, scope: string | null, read: () => Promise<T>, baseline?: object): Promise<T> {
  if (!current(scope)) return read();
  const key = JSON.stringify([sessionId, kind]);
  const existing = reads.get(key);
  if (existing && existing.baseline === baseline) return existing.request as Promise<T>;
  const request = read().finally(() => { if (reads.get(key)?.request === request) reads.delete(key); });
  reads.set(key, { baseline, request });
  return request;
}

export function forgetResearchMemory(sessionId: string, scope: string | null) {
  if (current(scope)) sessions.delete(sessionId);
}

// All name writes advance one revision, including successful rename mutations.
export function acceptResearchNameRead(sessionId: string, name: string, revision: number, scope: string | null): string | undefined {
  if (!scope) return name;
  if (!current(scope)) return undefined;
  const memory = readResearchMemory(sessionId, scope);
  if ((memory?.nameRevision ?? 0) === revision) writeResearchMemory(sessionId, { name }, scope);
  return readResearchMemory(sessionId, scope)?.name;
}
