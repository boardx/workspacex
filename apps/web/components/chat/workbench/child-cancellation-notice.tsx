import type { ExecutionEvent } from "@repo/contracts/execution-journal";
/** Journal facts belong to the current task's trace store; never retain an id across task switches. */
export function latestCancelledRun(events: Readonly<Record<string, readonly ExecutionEvent[]>>): string | null {
  return Object.entries(events).map(([runId, entries]) => ({ runId, status: [...entries].reverse().find(event => event.kind === "status") }))
    .filter(item => item.status?.kind === "status" && item.status.status === "cancelled")
    .sort((a, b) => (b.status?.emittedAt ?? "").localeCompare(a.status?.emittedAt ?? ""))[0]?.runId ?? null;
}
export function ChildCancellationNotice({ text }: { text: string | null }) {
  return text ? <p role="status" data-testid="child-cancellation-notice" className="rounded-container border border-border p-3 text-13 text-muted-foreground">{text}</p> : null;
}
