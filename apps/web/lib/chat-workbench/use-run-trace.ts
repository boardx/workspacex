"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { AGUI_EXECUTION_EVENT_NAME, parseExecutionEvent } from "@repo/contracts/execution-journal";
import { apiRequest, ApiError } from "@/lib/api-client";
import { reduceTrace, type TraceStore } from "./run-trace";

export function useRunTrace(agent: AbstractAgent, threadId: string | null) {
  const [events, setEvents] = React.useState<TraceStore>({});
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
        setEvents((previous) => reduceTrace(previous, [parsed]));
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
  }, [agent]);
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
            const result = await apiRequest<{ events: unknown[]; nextSeq: number | null }>(
              `/agent-runs/${encodeURIComponent(runId)}/execution-events?afterSeq=${afterSeq}`,
              { sessionToken: bearer, signal: controller.signal },
            );
            if (generation.current !== token) return;
            const parsed = result.events.map(parseExecutionEvent).filter((event) => event !== null);
            setEvents((previous) => reduceTrace(previous, parsed));
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

  }, []);
  return { events, messageRuns, hydrate, acceptedRunEpoch };
}
