"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { AGUI_EXECUTION_EVENT_NAME, parseExecutionEvent } from "@repo/contracts/execution-journal";
import { ApiError } from "@/lib/api-client";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { readExecutionPage } from "./execution-events-api";
import { reduceTrace, type TraceStore } from "./run-trace";

export function useRunTrace(agent: AbstractAgent, threadId: string | null) {
  const [events, setEvents] = React.useState<TraceStore>({});
  const storeRef = React.useRef<TraceStore>({});
  const ingest = React.useCallback((incoming: readonly ExecutionEvent[]) => {
    const next = reduceTrace(storeRef.current, incoming);
    storeRef.current = next;
    setEvents(next);
    return next;
  }, []);
  const [messageRuns, setMessageRuns] = React.useState<Record<string, string>>({});
  const currentRun = React.useRef<string | null>(null);
  const acceptedRunEpoch = React.useRef(0);
  const previousThread = React.useRef(threadId);
  const generation = React.useRef(0);
  const controllers = React.useRef(new Set<AbortController>());
  React.useEffect(() => {
    const resolvedInPlace = previousThread.current === null && threadId !== null && currentRun.current !== null;
    previousThread.current = threadId;
    if (resolvedInPlace) return;
    generation.current += 1;
    currentRun.current = null;
    storeRef.current = {};
    setEvents({}); setMessageRuns({});
    return () => { for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, [agent, threadId]);
  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => { currentRun.current = null; },
      onCustomEvent: ({ event }) => {
        if (event.name !== AGUI_EXECUTION_EVENT_NAME) return;
        const parsed = parseExecutionEvent(event.value);
        if (!parsed) return;
        currentRun.current = parsed.runId;
        if (parsed.kind === "status" && parsed.status === "running") acceptedRunEpoch.current += 1;
        if (parsed.kind === "text_delta") setMessageRuns((previous) => ({ ...previous, [parsed.messageId]: parsed.runId }));
        ingest([parsed]);
      },
      onToolCallStartEvent: ({ event }) => {
        const runId = currentRun.current;
        if (runId && event.parentMessageId) setMessageRuns((previous) => ({ ...previous, [event.parentMessageId!]: runId }));
      },
      onTextMessageStartEvent: ({ event }) => {
        const runId = currentRun.current;
        if (runId) setMessageRuns((previous) => ({ ...previous, [event.messageId]: runId }));
      },
    });
    return unsubscribe;
  }, [agent, ingest]);
  const hydrate = React.useCallback(async (messages: readonly { id: string; agentRunId?: string | null }[], bearer?: string) => {
    const token = generation.current;
    const pairs = messages.filter((message) => message.agentRunId).map((message) => [message.id, message.agentRunId!] as const);
    setMessageRuns((previous) => ({ ...previous, ...Object.fromEntries(pairs) }));
    const controller = new AbortController();
    controllers.current.add(controller);
    const pending = [...new Set(pairs.map(([, runId]) => runId))];
    const failures: unknown[] = [];
    const worker = async () => {
      while (pending.length && !controller.signal.aborted) {
        const runId = pending.shift()!;
        let afterSeq = -1;
        try {
          while (!controller.signal.aborted) {
            const result = await readExecutionPage(runId, afterSeq, bearer, controller.signal);
            if (generation.current !== token) return;
            const parsed = result.events;
            ingest(parsed);
            if (result.nextSeq === null || result.nextSeq <= afterSeq) break;
            afterSeq = result.nextSeq;
          }
        } catch (error) {
          if (!controller.signal.aborted && !(error instanceof ApiError && error.status === 404)) failures.push(error);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
      if (failures.length && generation.current === token) throw failures[0];
    } finally { controllers.current.delete(controller); }

  }, [ingest]);
  const append = React.useCallback((incoming: readonly ExecutionEvent[]) => {
    const next = ingest(incoming);
    const deltas = incoming.filter((event) => event.kind === "text_delta");
    setMessageRuns((previous) => ({ ...previous, ...Object.fromEntries(deltas.map((event) => [event.messageId, event.runId])) }));
    if (agent.isRunning || !deltas.length) return;
    const messages = [...agent.messages];
    for (const id of new Set(deltas.map((event) => event.messageId))) {
      const runId = deltas.find((event) => event.messageId === id)!.runId;
      const content = (next[runId] ?? []).filter((event) => event.kind === "text_delta" && event.messageId === id)
        .map((event) => event.kind === "text_delta" ? event.delta : "").join("");
      const index = messages.findIndex((message) => message.id === id);
      if (index < 0) messages.push({ id, role: "assistant", content });
      else if (messages[index]?.role === "assistant") messages[index] = { ...messages[index]!, role: "assistant", content };
    }
    agent.setMessages(messages);
  }, [agent, ingest]);
  const bindMessages = React.useCallback((messages: readonly { id: string; agentRunId?: string | null }[]) => {
    setMessageRuns((previous) => ({ ...previous, ...Object.fromEntries(messages.filter((message) => message.agentRunId).map((message) => [message.id, message.agentRunId!])) }));
  }, []);
  return { events, messageRuns, hydrate, acceptedRunEpoch, append, bindMessages };
}
