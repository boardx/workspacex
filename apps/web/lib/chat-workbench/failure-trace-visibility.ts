import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries } from "./run-trace";

export function failureTraceKey(scope: string | undefined, runId: string, events: readonly ExecutionEvent[]): string | null {
  return scope ? `chat-hidden-failure:${JSON.stringify([scope, runId, [...events].reverse().find((event) => event.attemptId)?.attemptId ?? "legacy"])}` : null;
}
export function isSettledFailureTrace(events: readonly ExecutionEvent[]): boolean {
  const status = [...events].reverse().find((event) => event.kind === "status");
  return status?.kind === "status" && (status.status === "failed" ||
    ((status.status === "succeeded" || status.status === "cancelled") && traceEntries(events).some((entry) => entry.status === "failed")));
}
