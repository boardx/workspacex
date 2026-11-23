"use client";
import * as React from "react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { TraceStore } from "./run-trace";
import { readExecutionPage } from "./execution-events-api";
import { ApiError } from "@/lib/api-client";

function tailStatus(events: readonly ExecutionEvent[]) {
  return [...events].reverse().find(event => event.kind === "status")?.status;
}

function terminalStatus(status: ReturnType<typeof tailStatus>) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function executionTailDelay(events: readonly ExecutionEvent[], failures = 0): number | null {
  if (events.length && events.every((event) => event.source === "legacy") && !events.some((event) => event.kind === "status")) return null;
  const status = tailStatus(events);
  if (terminalStatus(status)) return null;
  if (failures) return Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
  return status === "paused" || status === "awaiting_tool_permission" ? 5000 : 1000;
}
/** REST resume has no AG-UI connection; tail the same durable journal with bounded concurrency. */
export function useRunTraceTail({ threadId, bearer, events, append, onSettled, onNewSuccess, observedRunId, observedRunIds = [] }: {
  observedRunId?: string | null; observedRunIds?: readonly string[];
  threadId: string | null; bearer?: string; events: TraceStore;
  append: (events: readonly ExecutionEvent[]) => void;
  onSettled: (runId: string) => Promise<boolean>;
  onNewSuccess?: (runId: string) => void;
}) {
  const latest = React.useRef({ events, append, onSettled, onNewSuccess });
  latest.current = { events, append, onSettled, onNewSuccess };
  const watched = React.useRef(new Set<string>());
  const newSuccesses = React.useRef(new Set<string>());
  React.useEffect(() => {
    watched.current.clear();
    newSuccesses.current.clear();
  }, [threadId, bearer]);
  const runKeys = [...new Set([...Object.keys(events), ...observedRunIds, ...(observedRunId ? [observedRunId] : [])])].sort().join("\n");
  const observedKeys = [...observedRunIds, ...(observedRunId ? [observedRunId] : [])].sort().join("\n");
  React.useEffect(() => {
    if (!threadId || !bearer || !runKeys) return;
    const controller = new AbortController();
    for (const runId of runKeys.split("\n")) if (observedKeys.split("\n").includes(runId) || executionTailDelay(latest.current.events[runId] ?? []) !== null) watched.current.add(runId);
    const tracked = [...watched.current];
    const nextAt = new Map(tracked.map((runId) => [runId, 0]));
    const failures = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const pending = tracked.filter((runId) => (nextAt.get(runId) ?? Infinity) <= Date.now());
      const worker = async () => {
        while (pending.length && !controller.signal.aborted) {
          const runId = pending.shift()!;
          try {
            const previous = latest.current.events[runId] ?? [];
            let cursor = previous.filter((event) => event.source !== "legacy").at(-1)?.seq ?? -1;
            let combined = previous;
            while (!controller.signal.aborted) {
              const page = await readExecutionPage(runId, cursor, bearer, controller.signal);
              if (controller.signal.aborted) return;
              latest.current.append(page.events);
              combined = [...combined, ...page.events];
              if (page.nextSeq === null || page.nextSeq <= cursor) break;
              cursor = page.nextSeq;
            }
            failures.delete(runId);
            const delay = executionTailDelay(combined);
            if (delay === null) {
              const priorStatus = tailStatus(previous);
              // History may contain completed runs. Only a transition from a previously
              // observed nonterminal state can trigger new work after writeback is visible.
              if (priorStatus && !terminalStatus(priorStatus) && tailStatus(combined) === "succeeded") {
                newSuccesses.current.add(runId);
              }
              const restored = await latest.current.onSettled(runId);
              if (controller.signal.aborted) return;
              nextAt.set(runId, restored ? Infinity : Date.now() + 1000);
              if (restored) {
                watched.current.delete(runId);
                if (newSuccesses.current.delete(runId)) latest.current.onNewSuccess?.(runId);
              }
            } else nextAt.set(runId, Date.now() + delay);
          } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) nextAt.set(runId, Infinity);
            else {
              const count = (failures.get(runId) ?? 0) + 1;
              failures.set(runId, count);
              nextAt.set(runId, Date.now() + (executionTailDelay([], count) ?? 30_000));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
      if (!controller.signal.aborted && [...nextAt.values()].some(Number.isFinite)) timer = setTimeout(() => { void tick(); }, 1000);
    };
    void tick();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [threadId, bearer, runKeys, observedKeys]);
}
