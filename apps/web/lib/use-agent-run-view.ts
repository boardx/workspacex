"use client";
import * as React from "react";
import { getAgentRun, type AgentRunView } from "./agent-run";

/**
 * uiux-r3 #4.3 / #4.5 —— 一条助手回合「属于哪条 run」之后，身份行与升级留痕都要读那条 run 的
 * **持久化**事实（`agentId`、`resolvedEscalations`），不是 composer 上此刻的临时选择——刷新后
 * 选择会回到默认，身份就塌成「AI 助手」。
 *
 * 同一条 run 的多个挂载点（身份行、留痕）共享一次在途请求；`invalidateAgentRunView` 在裁决后
 * 让订阅者重读。只读展示，绝不参与任何授权判定。
 *
 * 返回：`undefined` = 还在读；`null` = 没有 runId 或读失败（调用方回退）。
 */
type Entry = { view?: AgentRunView | null; promise?: Promise<void> };
const cache = new Map<string, Entry>();
/** 重读期间先用上一份，避免身份行/留痕闪一下。 */
const stale = new Map<string, AgentRunView>();
const listeners = new Map<string, Set<() => void>>();

function isSettled(view: AgentRunView | null): boolean {
  return view === null || ["succeeded", "failed", "cancelled"].includes(view.status);
}

function load(runId: string, bearer: string | undefined, fetchRun: typeof getAgentRun): Promise<void> {
  const existing = cache.get(runId);
  // 终态 run 的事实不再变，缓存复用；还没终态的（等裁决 / 在跑）每次挂载重读一次。
  if (existing?.promise && (existing.view === undefined || isSettled(existing.view))) return existing.promise;
  if (existing?.view) stale.set(runId, existing.view);
  const entry: Entry = {};
  // 带一个不会被取消的 signal：多个挂载点共享这一次读，任何一个卸载都不该把它掐掉。
  entry.promise = fetchRun(runId, bearer, new AbortController().signal).then(
    (view) => { entry.view = view; stale.delete(runId); },
    () => { entry.view = null; },
  );
  cache.set(runId, entry);
  return entry.promise;
}

/** 非 hook 场景（如反馈归属）共享同一份读：返回这条 run 的权威投影，读失败为 null。 */
export async function loadAgentRunView(
  runId: string,
  bearer?: string,
  fetchRun: typeof getAgentRun = getAgentRun,
): Promise<AgentRunView | null> {
  await load(runId, bearer, fetchRun);
  return cache.get(runId)?.view ?? stale.get(runId) ?? null;
}

/** 裁决之后调用：丢掉缓存并通知订阅者重读。 */
export function invalidateAgentRunView(runId: string): void {
  const previous = cache.get(runId)?.view;
  if (previous) stale.set(runId, previous);
  cache.delete(runId);
  for (const notify of listeners.get(runId) ?? []) notify();
}

/** 测试用：清掉模块缓存。 */
export function resetAgentRunViewCache(): void {
  cache.clear();
  stale.clear();
}

export function useAgentRunView(
  runId: string | null | undefined,
  bearer?: string,
  fetchRun: typeof getAgentRun = getAgentRun,
): AgentRunView | null | undefined {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!runId) return;
    let alive = true;
    const refresh = () => { void load(runId, bearer, fetchRun).then(() => { if (alive) force(); }); };
    const set = listeners.get(runId) ?? new Set();
    set.add(refresh);
    listeners.set(runId, set);
    refresh();
    return () => { alive = false; set.delete(refresh); };
  }, [runId, bearer, fetchRun]);
  if (!runId) return null;
  const entry = cache.get(runId);
  if (entry && "view" in entry) return entry.view;
  return stale.get(runId);
}
