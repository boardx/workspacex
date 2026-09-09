import type { ExecutionEvent } from "@repo/contracts/execution-journal";

export type TraceStore = Readonly<Record<string, readonly ExecutionEvent[]>>;
export type TraceEntry = {
  id: string; messageId?: string; kind: "progress" | "tool" | "skill"; text: string;
  status: "observed" | "running" | "succeeded" | "failed"; source?: "legacy"; args?: unknown; result?: unknown;
  activityStage?: string; attemptIds?: string[];
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
  const skillExecutions = new Map<string, TraceEntry>();
  for (const event of events) {
    if (event.kind === "final_message" || event.kind === "status" || event.kind === "interjection") continue;
    if (event.kind === "skill_activity") {
      const fact = event.fact;
      const toolCallId = "toolCallId" in fact ? fact.toolCallId : undefined;
      const readPath = "readPath" in fact ? fact.readPath : undefined;
      const errorCode = "errorCode" in fact ? fact.errorCode : undefined;
      const execution = Boolean(toolCallId);
      const key = execution ? `skill:${fact.skillId}:${fact.skillVersion}:${toolCallId}` : `skill-fact:${fact.factId}`;
      const next: TraceEntry = {
        id: key, kind: "skill", text: fact.skillStableName, activityStage: fact.stage,
        status: fact.stage === "execution_succeeded" ? "succeeded" : fact.stage === "execution_failed" ? "failed" : fact.stage === "execution_started" ? "running" : "observed",
        args: { skillId: fact.skillId, version: fact.skillVersion, packageDigest: fact.packageDigest, ...(readPath ? { readPath } : {}), ...(toolCallId ? { toolCallId } : {}) },
        ...(errorCode ? { result: { errorCode } } : {}),
        attemptIds: event.attemptId ? [event.attemptId] : [],
      };
      const previous = skillExecutions.get(key);
      if (previous) {
        const attempts = [...new Set([...(previous.attemptIds ?? []), ...(next.attemptIds ?? [])])];
        // A delayed started fact cannot undo an observed execution result.
        if (previous.status === "running" || next.status !== "running") Object.assign(previous, next);
        previous.attemptIds = attempts;
      } else { entries.push(next); skillExecutions.set(key, next); }
      continue;
    }
    if (event.kind === "text_delta") {
      if (event.source !== "legacy" && !progressIds.has(event.messageId)) continue;
      const previous = entries.at(-1);
      const id = `text:${event.messageId}`;
      if (previous?.messageId === event.messageId && previous.kind === "progress") previous.text += event.delta;
      else entries.push({ id: `${id}:${event.seq}`, messageId: event.messageId, kind: "progress", text: event.delta, status: "succeeded", source: event.source });
      continue;
    }
    const toolKey = event.sourceToolCallId ? `tool:${event.runId}:${event.sourceToolCallId}` : `${event.attemptId ?? ""}:${event.toolCallId}`;
    if (event.kind === "tool_start") {
      const previous = tools.get(toolKey);
      if (previous) {
        previous.attemptIds = [...new Set([...(previous.attemptIds ?? []), ...(event.attemptId ? [event.attemptId] : [])])];
        continue;
      }
      const args = event.args as { skill_stable_name?: unknown } | null;
      const skill = event.toolName === "call_skill";
      const entry: TraceEntry = {
        id: toolKey, kind: skill ? "skill" : "tool",
        // issue #3063 -- 展示名优先（run 侧写下的 `skillDisplayName` 快照），缺席才回显
        // `stable_name`：#3058 之后身份字段是合规 slug，中文名 skill 显示成 `skill-xxxxxxxx`。
        text: skill
          ? event.skillDisplayName ?? (typeof args?.skill_stable_name === "string" ? args.skill_stable_name : event.toolName)
          : event.toolName,
        status: "running", args: event.args, attemptIds: event.attemptId ? [event.attemptId] : [],
      };
      tools.set(toolKey, entry);
      entries.push(entry);
    } else {
      const entry = tools.get(toolKey);
      if (entry) { entry.status = event.ok ? "succeeded" : "failed"; entry.result = event.result; entry.attemptIds = [...new Set([...(entry.attemptIds ?? []), ...(event.attemptId ? [event.attemptId] : [])])]; }
      else { const completed: TraceEntry = { id: toolKey, kind: "tool", text: event.toolName, status: event.ok ? "succeeded" : "failed", result: event.result }; entries.push(completed); tools.set(toolKey, completed); }
    }
  }
  return entries;
}

export type TraceRow =
  | { kind: "entry"; id: string; entry: TraceEntry }
  | { kind: "skill-group"; id: string; stage: string; members: readonly TraceEntry[] };
/**
 * issue #3218 —— 呈现层折叠，**不是**事实层去重。
 *
 * 首轮一次问答真的会发生 20 次 `metadata_discovered`（组织内可见技能的全量发现），
 * 事实流如实记录每一条是对的；把 20 行平铺给用户看不是。这里把**相邻的**同阶段
 * 发现事实归成一行可展开的条目，成员一条不少地留在展开层里。
 *
 * 计数只有一处：面板顶部的「技能活动 N 项」仍然数 `traceEntries` 的事实条目，
 * 不数分组行——分组是从同一个 `entries` 派生出来的视图，不是第二份事实源。
 */
const GROUPED_STAGES = new Set(["metadata_discovered"]);
export function groupTraceRows(entries: readonly TraceEntry[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const entry of entries) {
    const groupable = entry.kind === "skill" && entry.activityStage !== undefined && GROUPED_STAGES.has(entry.activityStage);
    const previous = rows.at(-1);
    if (groupable && previous?.kind === "skill-group" && previous.stage === entry.activityStage) {
      rows[rows.length - 1] = { ...previous, members: [...previous.members, entry] };
      continue;
    }
    if (groupable && previous?.kind === "entry" && previous.entry.kind === "skill" && previous.entry.activityStage === entry.activityStage) {
      rows[rows.length - 1] = { kind: "skill-group", id: `group:${previous.entry.id}`, stage: entry.activityStage!, members: [previous.entry, entry] };
      continue;
    }
    rows.push({ kind: "entry", id: entry.id, entry });
  }
  return rows;
}
