import type { ExecutionEvent } from "@repo/contracts/execution-journal";

export type TraceStore = Readonly<Record<string, readonly ExecutionEvent[]>>;
export type TraceEntry = {
  id: string; messageId?: string; kind: "progress" | "tool" | "skill"; text: string;
  status: "running" | "succeeded" | "failed"; source?: "legacy"; args?: unknown; result?: unknown;
};
/** The server sequence is the identity, including during replay after reconnect. */
export function reduceTrace(store: TraceStore, events: readonly ExecutionEvent[]): TraceStore {
  if (!events.length) return store;
  const grouped = new Map<string, ExecutionEvent[]>();
  for (const event of events) {
    const batch = grouped.get(event.runId) ?? [];
    batch.push(event); grouped.set(event.runId, batch);
  }
  let next: Record<string, readonly ExecutionEvent[]> | undefined;
  for (const [runId, incoming] of grouped) {
    const prior = store[runId] ?? [];
    const hasCurrent = prior.some((event) => event.source !== "legacy") || incoming.some((event) => event.source !== "legacy");
    const existing = hasCurrent ? prior.filter((event) => event.source !== "legacy") : prior;
    const batch = hasCurrent ? incoming.filter((event) => event.source !== "legacy") : incoming;
    const known = new Set(existing.map((event) => event.seq));
    const added = batch.filter((event) => {
      if (known.has(event.seq)) return false;
      known.add(event.seq); return true;
    });
    if (!added.length && existing.length === prior.length) continue;
    next ??= { ...store };
    const ordered = added.every((event, index) => index === 0 || event.seq > added[index - 1]!.seq);
    next[runId] = ordered && (!added.length || !existing.length || added[0]!.seq > existing.at(-1)!.seq)
      ? [...existing, ...added] : [...existing, ...added].sort((a, b) => a.seq - b.seq);
  }
  return next ?? store;
}
/** A tool boundary confirms that earlier public text was progress, not the answer. */
export function progressMessageIds(events: readonly ExecutionEvent[]): Set<string> {
  const seen = new Set<string>();
  const progress = new Set<string>();
  for (const event of events) {
    if (event.kind === "text_delta") seen.add(event.messageId);
    if (event.kind === "tool_start") for (const id of seen) progress.add(id);
    if (event.kind === "final_message") progress.delete(event.messageId);
  }
  for (const event of events) if (event.kind === "final_message") progress.delete(event.messageId);
  return progress;
}
export function traceEntries(events: readonly ExecutionEvent[]): TraceEntry[] {
  const progressIds = progressMessageIds(events);
  const entries: TraceEntry[] = [];
  const tools = new Map<string, TraceEntry>();
  for (const event of events) {
    if (event.kind === "final_message" || event.kind === "status" || event.kind === "interjection") continue;
    if (event.kind === "text_delta") {
      if (event.source !== "legacy" && !progressIds.has(event.messageId)) continue;
      const previous = entries.at(-1);
      const id = `text:${event.messageId}`;
      if (previous?.messageId === event.messageId && previous.kind === "progress") previous.text += event.delta;
      else entries.push({ id: `${id}:${event.seq}`, messageId: event.messageId, kind: "progress", text: event.delta, status: "succeeded", source: event.source });
      continue;
    }
    const toolKey = `${event.attemptId ?? ""}:${event.toolCallId}`;
    if (event.kind === "tool_start") {
      const args = event.args as { skill_stable_name?: unknown } | null;
      const skill = event.toolName === "call_skill";
      const entry: TraceEntry = {
        id: toolKey, kind: skill ? "skill" : "tool",
        text: skill && typeof args?.skill_stable_name === "string" ? args.skill_stable_name : event.toolName,
        status: "running", args: event.args,
      };
      tools.set(toolKey, entry);
      entries.push(entry);
    } else {
      const entry = tools.get(toolKey);
      if (entry) { entry.status = event.ok ? "succeeded" : "failed"; entry.result = event.result; }
      else entries.push({ id: toolKey, kind: "tool", text: event.toolName, status: event.ok ? "succeeded" : "failed", result: event.result });
    }
  }
  return entries;
}
