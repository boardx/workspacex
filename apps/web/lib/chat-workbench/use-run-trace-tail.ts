"use client";
import * as React from "react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { TraceStore } from "./run-trace";
import { readExecutionPage } from "./execution-events-api";
import { ApiError } from "@/lib/api-client";

export function executionTailDelay(events: readonly ExecutionEvent[], failures = 0): number | null {
  const status = [...events].reverse().find((event) => event.kind === "status");
  if (status?.kind === "status" && (status.status === "succeeded" || status.status === "failed" || status.status === "cancelled")) return null;
  if (failures) return Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
  return status?.kind === "status" && (status.status === "paused" || status.status === "awaiting_tool_permission") ? 5000 : 1000;
}
/** REST resume has no AG-UI connection; tail the same durable journal with bounded concurrency. */
export function useRunTraceTail({ threadId, bearer, events, append, onSettled }: {
  threadId: string | null; bearer?: string; events: TraceStore;
  append: (events: readonly ExecutionEvent[]) => void;
  onSettled: (runId: string) => Promise<boolean>;
}) {
  const latest = React.useRef({ events, append, onSettled });
  latest.current = { events, append, onSettled };
  const watched = React.useRef(new Set<string>());
  React.useEffect(() => { watched.current.clear(); }, [threadId, bearer]);
  const runKeys = Object.keys(events).sort().join("\n");
  React.useEffect(() => {
    if (!threadId || !bearer || !runKeys) return;
    const controller = new AbortController();
    for (const runId of runKeys.split("\n")) if (executionTailDelay(latest.current.events[runId] ?? []) !== null) watched.current.add(runId);
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
            let cursor = previous.at(-1)?.seq ?? -1;
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
              const restored = await latest.current.onSettled(runId);
              nextAt.set(runId, restored ? Infinity : Date.now() + 1000);
              if (restored) watched.current.delete(runId);
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
  }, [threadId, bearer, runKeys]);
}
