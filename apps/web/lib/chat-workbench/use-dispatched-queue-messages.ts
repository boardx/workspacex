"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
import { getAgentRun } from "@/lib/agent-run";
const EMPTY_RUN_IDS: string[] = [];
/** Render a dispatched user's message only with the accepted message identity returned by the run. */
export function useDispatchedQueueMessages(agent: AbstractAgent, items: QueuedMessage[], threadId: string | null, bearer: string | null,
  register: (messages: { id: string; rateable: boolean }[]) => void, bind: (messages: { id: string; agentRunId: string }[]) => void) {
  const source = `${threadId ?? ""}:${bearer ?? ""}`;
  const [ready, setReady] = React.useState<{ source: string; runIds: string[] }>({ source, runIds: [] });
  const [retry, setRetry] = React.useState(0);
  const completed = React.useRef(new Set<string>());
  React.useEffect(() => { completed.current.clear(); setReady({ source, runIds: [] }); }, [source]);
  React.useEffect(() => {
    if (!threadId || !bearer) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const pending = items.filter((item) => item.status === "dispatched" && item.runId && !completed.current.has(item.id));
    const worker = async () => {
      while (pending.length && !controller.signal.aborted) {
        const item = pending.shift()!;
        try {
          const run = await getAgentRun(item.runId!, bearer, controller.signal);
          if (controller.signal.aborted) return;
          if (!agent.messages.some((message) => message.id === run.inputMessageId)) agent.addMessage({ id: run.inputMessageId, role: "user", content: item.text });
          register([{ id: run.inputMessageId, rateable: false }]); bind([{ id: run.inputMessageId, agentRunId: run.runId }]); completed.current.add(item.id);
          setReady((previous) => ({ source, runIds: [...new Set([...(previous.source === source ? previous.runIds : []), run.runId])] }));
        } catch { if (!controller.signal.aborted) timer = setTimeout(() => { if (!controller.signal.aborted) setRetry((value) => value + 1); }, 3000); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [agent, items, threadId, bearer, register, bind, retry, source]);
  return ready.source === source ? ready.runIds : EMPTY_RUN_IDS;
}
