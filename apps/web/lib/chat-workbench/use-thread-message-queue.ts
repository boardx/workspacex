"use client";
import * as React from "react";
import { operations, type QueuedMessage } from "@repo/contracts/thread-message-queue";
import { apiRequest } from "@/lib/api-client";
const EMPTY: QueuedMessage[] = [];
/** The server alone dispatches accepted queue items. Browser polling only observes them. */
export function useThreadMessageQueue(threadId: string | null, agentId: string | null, bearer: string | null) {
  const source = `${threadId ?? ""}:${bearer ?? ""}`;
  const revision = React.useRef(0);
  const current = React.useRef(source); current.current = source;
  const [snapshot, setSnapshot] = React.useState<{ source: string; items: QueuedMessage[] }>({ source, items: [] });
  const [failure, setFailure] = React.useState<{ source: string; value: string | null }>({ source, value: null });
  const [cancellation, setCancellation] = React.useState<{ source: string; value: string | null }>({ source, value: null });
  const setError = React.useCallback((value: string | null) => setFailure({ source, value }), [source]);
  const setCancelling = React.useCallback((value: string | null) => setCancellation({ source, value }), [source]);
  const error = failure.source === source ? failure.value : null;
  const cancelling = cancellation.source === source ? cancellation.value : null;
  const items = snapshot.source === source ? snapshot.items : EMPTY;
  const path = operations.list.path.replace(":threadId", encodeURIComponent(threadId ?? ""));
  const update = React.useCallback((next: QueuedMessage[]) => {
    if (current.current === source) setSnapshot((previous) => previous.source === source && JSON.stringify(previous.items) === JSON.stringify(next) ? previous : { source, items: next });
  }, [source]);
  React.useEffect(() => {
    if (!threadId || !bearer) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let pending = false; const readingRevision = revision.current;
      try {
        const result = operations.list.out.parse(await apiRequest(path, { sessionToken: bearer, signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (revision.current === readingRevision) { update(result.items); setError(null); } pending = result.items.some((item) => item.status === "pending");
      } catch (cause) { if (!controller.signal.aborted && current.current === source) setError(cause instanceof Error ? cause.message : "队列读取失败"); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), pending ? 1500 : 5000);
    };
    setError(null); void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [threadId, bearer, path, source, update, setError]);
  const enqueue = React.useCallback(async (text: string, options?: { clientMessageId?: string }): Promise<boolean> => {
    if (!threadId || !bearer) { setError("对话尚未建立，请保留草稿稍后重试"); return false; }
    try {
      const body = operations.enqueue.in.parse({ text, clientRequestId: options?.clientMessageId ?? crypto.randomUUID(), agentId });
      const item = operations.enqueue.out.parse(await apiRequest(path, { method: "POST", body, sessionToken: bearer }));
      if (current.current === source) {
        revision.current += 1;
        setSnapshot((previous) => ({ source, items: [...(previous.source === source ? previous.items.filter((value) => value.id !== item.id) : []), item] }));
        setError(null);
      }
      return true;
    } catch (cause) { if (current.current === source) setError(cause instanceof Error ? cause.message : "队列提交失败，草稿已保留"); return false; }
  }, [threadId, bearer, agentId, path, source, setError]);
  const cancel = React.useCallback(async (id: string): Promise<void> => {
    if (!threadId || !bearer) return;
    setCancelling(id);
    try {
      const item = operations.cancel.out.parse(await apiRequest(`${path}/${encodeURIComponent(id)}`, { method: "DELETE", sessionToken: bearer }));
      if (current.current === source) { revision.current += 1; setSnapshot((previous) => ({ source, items: previous.items.map((value) => value.id === id ? item : value) })); }
    } catch (cause) { if (current.current === source) setError(cause instanceof Error ? cause.message : "撤回失败，消息可能已开始执行"); }
    finally { if (current.current === source) setCancelling(null); }
  }, [threadId, bearer, path, source, setError, setCancelling]);
  return { items, enqueue, cancel, cancelling, error };
}
