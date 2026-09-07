"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { ChatHostInterjectionRun } from "@/lib/chat-host-interjection-run";
import { classifyInterjectFailure, interjectAgentRun, INTERJECT_FAILURE_COPY, INTERJECT_UNKNOWN_FAILURE_COPY } from "@/lib/agent-kernel-interject";
import { resolveRunningReplyRoute, runningReplyAckCopy } from "@/lib/chat-composer-running-reply";

type QueuedReply = { id: string; text: string };
const EMPTY_QUEUE: QueuedReply[] = [];
/** Each queued delivery retains its idempotency key until an explicit successful ACK. */
export function useRunningReply({ agent, threadId, draftScope, run, inputDraft, inputDraftRevision, sessionToken, enqueue, clearDraft, setError, canWrite = true }: {
  agent: AbstractAgent; threadId: string; run: ChatHostInterjectionRun; inputDraft: string; sessionToken: string | null;
  enqueue: (text: string, opts?: { clientMessageId?: string }) => Promise<boolean>;
  canWrite?: boolean;
  draftScope?: string;
  inputDraftRevision?: number;
  clearDraft: (revision?: number) => void; setError: (error: string | null) => void;
}) {
  const storageKey = `workbench-queued-replies:${draftScope ?? "anonymous"}`;
  const [queues, setQueues] = React.useState<Record<string, QueuedReply[]>>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"); } catch { return {}; }
  });
  const [loadedStorageKey, setLoadedStorageKey] = React.useState(storageKey);
  const queue = loadedStorageKey === storageKey ? queues[threadId] ?? EMPTY_QUEUE : EMPTY_QUEUE;
  const [failedThreads, setFailedThreads] = React.useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(queues).map((id) => [id, true])));
  const queuedFailed = loadedStorageKey === storageKey ? failedThreads[threadId] ?? false : false;
  React.useEffect(() => {
    if (loadedStorageKey !== storageKey) {
      let restored: Record<string, QueuedReply[]> = {};
      try { restored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"); } catch { /* Empty local draft. */ }
      setQueues(restored); setFailedThreads(Object.fromEntries(Object.keys(restored).map((id) => [id, true])));
      setLoadedStorageKey(storageKey); return;
    }
    try { sessionStorage.setItem(storageKey, JSON.stringify(queues)); } catch { /* Retain in memory if storage is disabled. */ }
  }, [queues, storageKey, loadedStorageKey]);
  const [runningReplyAck, setRunningReplyAck] = React.useState<string | null>(null);
  const [interjectPending, setInterjectPending] = React.useState(false);
  const [delivering, setDelivering] = React.useState(false);
  const scope = JSON.stringify([threadId, draftScope ?? "anonymous", sessionToken]);
  const currentScope = React.useRef(scope);
  currentScope.current = scope;
  const sending = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sendWhileRunning = React.useCallback(async (options?: { forceQueue?: boolean }) => {
    const text = inputDraft.trim();
    if (!canWrite || !text || sending.current) return;
    setError(null);
    if (options?.forceQueue || resolveRunningReplyRoute({ runId: run.runId, status: run.status }) === "queue") {
      const entry = { id: crypto.randomUUID(), text };
      setQueues((previous) => ({ ...previous, [threadId]: [...(previous[threadId] ?? []), entry] }));
      clearDraft(inputDraftRevision);
      return;
    }
    sending.current = true;
    setInterjectPending(true);
    try {
      const receipt = await interjectAgentRun({ runId: run.runId!, text }, { sessionToken });
      if (!mounted.current || currentScope.current !== scope) return;
      agent.addMessage({ id: `interjection:${receipt.interjectionId}`, role: "user", content: text });
      clearDraft(inputDraftRevision);
      setRunningReplyAck(runningReplyAckCopy(text));
    } catch (error) {
      if (!mounted.current || currentScope.current !== scope) return;
      const code = classifyInterjectFailure(error);
      setError(code ? INTERJECT_FAILURE_COPY[code] : INTERJECT_UNKNOWN_FAILURE_COPY);
    } finally { if (mounted.current && currentScope.current === scope) { sending.current = false; setInterjectPending(false); } }
  }, [inputDraft, inputDraftRevision, run.runId, run.status, sessionToken, agent, clearDraft, setError, threadId, canWrite, scope]);
  React.useEffect(() => {
    if (!canWrite || loadedStorageKey !== storageKey || !queue.length || delivering || interjectPending || sending.current || queuedFailed) return;
    const entry = queue[0]!;
    sending.current = true;
    setDelivering(true);
    void enqueue(entry.text, { clientMessageId: entry.id }).then((ok) => {
      if (!mounted.current || currentScope.current !== scope) return;
      if (ok) setQueues((previous) => ({ ...previous, [threadId]: (previous[threadId] ?? []).filter((item) => item.id !== entry.id) }));
      else setFailedThreads((previous) => ({ ...previous, [threadId]: true }));
    }).catch(() => { if (mounted.current && currentScope.current === scope) setFailedThreads((previous) => ({ ...previous, [threadId]: true })); })
      .finally(() => { if (mounted.current && currentScope.current === scope) { sending.current = false; setDelivering(false); } });
  }, [queue, enqueue, delivering, interjectPending, queuedFailed, threadId, canWrite, scope, loadedStorageKey, storageKey]);
  React.useEffect(() => {
    sending.current = false; setDelivering(false); setInterjectPending(false); setRunningReplyAck(null);
  }, [scope]);
  React.useEffect(() => {
    if (runningReplyAck === null) return;
    const timer = window.setTimeout(() => setRunningReplyAck(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [runningReplyAck]);
  return {
    queuedReply: queue.length ? queue.map((entry) => entry.text).join("\n") : null,
    queuedFailed,
    retryQueuedReply: () => setFailedThreads((previous) => ({ ...previous, [threadId]: false })),
    setQueuedReply: (text: string | null) => {
      setQueues((previous) => ({ ...previous, [threadId]: text === null ? [] : [{ id: crypto.randomUUID(), text }] }));
      setFailedThreads((previous) => ({ ...previous, [threadId]: false }));
    },
    runningReplyAck, interjectPending: interjectPending || delivering, sendWhileRunning,
  };
}
