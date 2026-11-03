"use client";
import * as React from "react";
import { listAgentDirectory, type AgentDirectoryCard } from "./agent-directory";
import { useI18n } from "./i18n/provider";
import type { Locale } from "@repo/contracts/locale";
import { useOptionalSession } from "@/components/session/session-provider";
import { ENTITY_LOCALIZATION_UPDATED } from "./entity-localization";

/**
 * 数字人头像（dh-* 插画）在聊天里的数据源：成员 Agent 目录 `GET /agents/directory`
 * 是唯一带 `avatar.key` 的成员可读端点（`CapabilityListing` 不带头像）。
 *
 * 同一页里 composer 选人器、消息作者头像、升级卡片都要读它——模块级共享一次在途请求，
 * 不让每个挂载点各打一次。失败即空表（调用方回退首字母头像），下次挂载会重试。
 * 只读展示，绝不参与任何授权判定。
 */
type DirectoryMap = ReadonlyMap<string, AgentDirectoryCard>;
const EMPTY: DirectoryMap = new Map();

type FetchDirectory = (filters?: { locale?: Locale }) => Promise<readonly AgentDirectoryCard[]>;
type Entry = { promise: Promise<DirectoryMap>; resolved: DirectoryMap | null };
let caches = new WeakMap<FetchDirectory, Map<string, Entry>>();
const sessionEpochs = new WeakMap<object, number>();
let nextSessionEpoch = 0;
function sessionEpoch(session: object | null | undefined) {
  if (!session) return 0;
  let epoch = sessionEpochs.get(session);
  if (epoch === undefined) { epoch = ++nextSessionEpoch; sessionEpochs.set(session, epoch); }
  return epoch;
}
function scopeCache(fetchDirectory: FetchDirectory): Map<string, Entry> {
  let scoped = caches.get(fetchDirectory);
  if (!scoped) { scoped = new Map(); caches.set(fetchDirectory, scoped); }
  return scoped;
}

function loadShared(fetchDirectory: FetchDirectory, scope: string, locale: Locale): Promise<DirectoryMap> {
  const cache = scopeCache(fetchDirectory);
  const existing = cache.get(scope);
  if (existing) return existing.promise;
  const entry: Entry = { resolved: null, promise: Promise.resolve(EMPTY) };
  entry.promise = fetchDirectory({ locale }).then(
    cards => { entry.resolved = new Map(cards.map(card => [card.agentId, card])); return entry.resolved; },
    () => { if (cache.get(scope) === entry) cache.delete(scope); return EMPTY; },
  );
  cache.set(scope, entry);
  return entry.promise;
}

/** 测试用：清掉模块缓存。 */
export function resetAgentDirectoryMapCache(): void {
  caches = new WeakMap();
}
// Reset once before individual consumers refresh, preserving request deduplication.
if (typeof window !== "undefined") window.addEventListener(ENTITY_LOCALIZATION_UPDATED, event => {
  if ((event as CustomEvent<{ kind?: string }>).detail?.kind === "agent") resetAgentDirectoryMapCache();
});

export function useAgentDirectoryMap(
  enabled = true,
  fetchDirectory: FetchDirectory = listAgentDirectory,
): DirectoryMap {
  const { locale } = useI18n();
  const context = useOptionalSession();
  const session = context?.session;
  const scope = `${sessionEpoch(session)}:${context?.status ?? "standalone"}:${session?.userId ?? ""}:${session?.currentOrgId ?? ""}:${context?.identity?.orgRole ?? ""}:${context?.identity?.org.team ?? ""}:${locale}`;
  const available = enabled && (!context || context.status === "authenticated");
  const [state, setState] = React.useState<{ scope: string; fetcher: FetchDirectory; map: DirectoryMap }>(() => ({ scope, fetcher: fetchDirectory, map: scopeCache(fetchDirectory).get(scope)?.resolved ?? EMPTY }));
  React.useEffect(() => {
    if (!available) return;
    let alive = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      void loadShared(fetchDirectory, scope, locale).then(map => { if (alive && request === generation) setState({ scope, fetcher: fetchDirectory, map }); });
    };
    const changed = (event: Event) => { if ((event as CustomEvent<{ kind?: string }>).detail?.kind === "agent") load(); };
    load(); window.addEventListener(ENTITY_LOCALIZATION_UPDATED, changed);
    return () => { alive = false; window.removeEventListener(ENTITY_LOCALIZATION_UPDATED, changed); };
  }, [available, fetchDirectory, locale, scope]);
  if (!available) return EMPTY;
  return state.scope === scope && state.fetcher === fetchDirectory ? state.map : scopeCache(fetchDirectory).get(scope)?.resolved ?? EMPTY;
}
