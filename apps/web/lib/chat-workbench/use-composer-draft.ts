"use client";
import * as React from "react";
export type DraftScope = { orgId: string | null; userId: string | null; projectId: string | null; threadId: string | null };
function keyOf(scope: DraftScope): string | null {
  return scope.orgId && scope.userId ? `workbench-draft:${JSON.stringify([scope.orgId, scope.userId, scope.projectId, scope.threadId])}` : null;
}
function read(key: string | null): string { try { return key ? sessionStorage.getItem(key) ?? "" : ""; } catch { return ""; } }
function write(key: string | null, text: string) { try { if (key) { if (text) sessionStorage.setItem(key, text); else sessionStorage.removeItem(key); } } catch { /* Keep the in-memory draft when storage is unavailable. */ } }
/** Unsent text survives task navigation. A newly created task takes ownership of its draft. */
export function useComposerDraft(scope: DraftScope) {
  const key = keyOf(scope);
  const identity = JSON.stringify([scope.orgId, scope.userId, scope.projectId]);
  const [state, setState] = React.useState(() => ({ key, identity, threadId: scope.threadId, text: read(key), revision: 0 }));
  const migrating = state.key !== key && state.identity === identity && state.threadId === null && scope.threadId !== null;
  const current = React.useMemo(() => state.key === key ? state : { key, identity, threadId: scope.threadId, text: migrating ? state.text : read(key), revision: state.revision + 1 }, [state, key, identity, scope.threadId, migrating]);
  const latest = React.useRef(current); latest.current = current;
  React.useEffect(() => {
    if (state.key === key) return;
    if (migrating) { write(key, current.text); write(state.key, ""); }
    setState(current);
  }, [key, state, current, migrating]);
  const setText = React.useCallback((value: React.SetStateAction<string>) => {
    const previous = latest.current;
    const text = typeof value === "function" ? value(previous.text) : value;
    const next = { ...previous, text, revision: previous.revision + 1 };
    latest.current = next; write(next.key, text); setState(next);
  }, []);
  const clear = React.useCallback((revision?: number) => {
    if (revision !== undefined && latest.current.revision !== revision) return;
    setText("");
  }, [setText]);
  return { text: current.text, revision: current.revision, setText, clear };
}
