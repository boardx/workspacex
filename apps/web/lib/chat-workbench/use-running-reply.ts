"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { ChatHostInterjectionRun } from "@/lib/chat-host-interjection-run";
import { classifyInterjectFailure, interjectAgentRun, INTERJECT_FAILURE_COPY, INTERJECT_UNKNOWN_FAILURE_COPY } from "@/lib/agent-kernel-interject";
import { resolveRunningReplyRoute, runningReplyAckCopy } from "@/lib/chat-composer-running-reply";

type QueuedReply = { id: string; text: string };
/** Each queued delivery retains its idempotency key until an explicit successful ACK. */
export function useRunningReply({ agent, threadId, run, inputDraft, sessionToken, runIsRunning, send, clearDraft, setError }: {
  agent: AbstractAgent; threadId: string; run: ChatHostInterjectionRun; inputDraft: string; sessionToken: string | null;
  runIsRunning: boolean; send: (text: string, opts?: { clientMessageId?: string }) => Promise<boolean>;
  clearDraft: () => void; setError: (error: string | null) => void;
}) {
  const [queues, setQueues] = React.useState<Record<string, QueuedReply[]>>({});
  const queue = queues[threadId] ?? [];
  const [failedThreads, setFailedThreads] = React.useState<Record<string, boolean>>({});
  const queuedFailed = failedThreads[threadId] ?? false;
  const [runningReplyAck, setRunningReplyAck] = React.useState<string | null>(null);
  const [interjectPending, setInterjectPending] = React.useState(false);
  const [delivering, setDelivering] = React.useState(false);
  const currentThread = React.useRef(threadId);
  currentThread.current = threadId;
  const sending = React.useRef(false);
  const sendWhileRunning = React.useCallback(async () => {
    const text = inputDraft.trim();
    if (!text || sending.current) return;
    setError(null);
    if (resolveRunningReplyRoute({ runId: run.runId, status: run.status }) === "queue") {
      const entry = { id: crypto.randomUUID(), text };
      setQueues((previous) => ({ ...previous, [threadId]: [...(previous[threadId] ?? []), entry] }));
      clearDraft();
      return;
    }
    sending.current = true;
    setInterjectPending(true);
    try {
      await interjectAgentRun({ runId: run.runId!, text }, { sessionToken });
      if (currentThread.current !== threadId) return;
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      clearDraft();
      setRunningReplyAck(runningReplyAckCopy(text));
    } catch (error) {
      if (currentThread.current !== threadId) return;
      const code = classifyInterjectFailure(error);
      setError(code ? INTERJECT_FAILURE_COPY[code] : INTERJECT_UNKNOWN_FAILURE_COPY);
    } finally { sending.current = false; setInterjectPending(false); }
  }, [inputDraft, run.runId, run.status, sessionToken, agent, clearDraft, setError, threadId]);
  React.useEffect(() => {
    if (runIsRunning || !queue.length || delivering || interjectPending || sending.current || queuedFailed) return;
    const entry = queue[0]!;
    sending.current = true;
    setDelivering(true);
    void send(entry.text, { clientMessageId: entry.id }).then((ok) => {
      if (ok) setQueues((previous) => ({ ...previous, [threadId]: (previous[threadId] ?? []).filter((item) => item.id !== entry.id) }));
      else setFailedThreads((previous) => ({ ...previous, [threadId]: true }));
    }).catch(() => setFailedThreads((previous) => ({ ...previous, [threadId]: true })))
      .finally(() => { sending.current = false; setDelivering(false); });
  }, [runIsRunning, queue, send, delivering, interjectPending, queuedFailed, threadId]);
  React.useEffect(() => { setRunningReplyAck(null); }, [threadId]);
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
    runningReplyAck, interjectPending, sendWhileRunning,
  };
}
