"use client";
import * as React from "react";

export type HostRunSenderScope = Readonly<{ orgId?: string | null; userId?: string | null; sessionToken?: string | null; projectId?: string | null; threadId?: string | null }>;
export type HostRunScope = Readonly<Required<{ [K in keyof HostRunSenderScope]: string }> & { task: string }>;
export type HostRunObservation = Readonly<{ runId: string; threadId: string; clientMessageId: string | null }>;
export type FrozenHostRunContext = Readonly<{ forwardedProps: Readonly<Record<string, unknown>>; matches: (sender: HostRunSenderScope) => boolean; threadId: string; started: (clientMessageId:string) => void; accepted: (observation: HostRunObservation) => void }>;
type Port = { generation: number; capture: (sender: HostRunSenderScope) => FrozenHostRunContext; observe: (sender: HostRunSenderScope, observation: HostRunObservation, generation: number) => void };
export const HOST_RUN_CONTEXT_UNAVAILABLE = "本次材料或访问范围尚未就绪，请重新核对后发送；草稿已保留。";
export const HOST_RUN_BUSY = "当前讨论还在运行，请完成后再发送；草稿已保留。";
const Context = React.createContext<Port | null>(null);
const scopeKeys = ["orgId", "userId", "sessionToken", "projectId", "threadId"] as const;
const sameSender = (a: HostRunSenderScope, b: HostRunSenderScope) => scopeKeys.every(key => a[key] === b[key]);
function freeze(value: unknown): void { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } }
function freezeProps(value: Readonly<Record<string, unknown>>) {
  const reserved = ["chatThreadId", "clientMessageId", "attachmentIds", "realtimeContext", "permissionRequestId", "toolChoice"];
  if (reserved.some(key => Object.hasOwn(value, key))) throw new Error("HOST_RUN_CONTEXT_INVALID");
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>; freeze(copy); return copy;
}

/** Optional transport data only. The host's selector never grants server permissions. */
export function HostRunContextProvider({ scope, forwardedProps, onRunAccepted, onAttemptStarted, children }: { scope: HostRunScope; forwardedProps: Readonly<Record<string, unknown>> | null; onRunAccepted?: (observation: HostRunObservation) => void; onAttemptStarted?:(clientMessageId:string)=>void; children: React.ReactNode }) {
  const key = JSON.stringify([...scopeKeys.map(field => scope[field]), scope.task]);
  const lifetime = React.useRef({ key, generation: 0, active: true, scope, forwardedProps, onRunAccepted, onAttemptStarted, clientMessageId:null as string|null, observed:new Set<string>() });
  if (lifetime.current.key !== key) { lifetime.current.generation++; lifetime.current.clientMessageId=null; lifetime.current.observed.clear(); }
  Object.assign(lifetime.current, { key, scope, forwardedProps, onRunAccepted, onAttemptStarted });
  React.useEffect(() => { const owner = lifetime.current; owner.active = true; return () => { owner.active = false; }; }, []);
  const publish = React.useCallback((generation:number,observation:HostRunObservation) => {
    const owner=lifetime.current;
    if(!owner.active || owner.generation!==generation || observation.threadId!==owner.scope.threadId || owner.clientMessageId!==null && observation.clientMessageId!==owner.clientMessageId || owner.observed.has(observation.runId)) return;
    owner.observed.add(observation.runId); owner.onRunAccepted?.(observation);
  },[]);
  const port = React.useMemo<Port>(() => { const generation = lifetime.current.generation; return { generation, capture(sender) {
    const owner = lifetime.current;
    if (!owner.active || owner.key !== key || owner.generation !== generation || !forwardedProps || !owner.forwardedProps || !scopeKeys.every(field => !!owner.scope[field]) || !sameSender(sender, owner.scope)) throw new Error("HOST_RUN_CONTEXT_UNAVAILABLE");
    const boundScope = { ...owner.scope }, props = freezeProps(owner.forwardedProps);
    return Object.freeze({ forwardedProps: props, threadId: boundScope.threadId, matches: (current: HostRunSenderScope) => lifetime.current.active && lifetime.current.generation === generation && sameSender(current, boundScope), started: clientMessageId => { const owner=lifetime.current; if(owner.active && owner.generation===generation && owner.forwardedProps && clientMessageId!==owner.clientMessageId) {owner.clientMessageId=clientMessageId;owner.observed.clear();owner.onAttemptStarted?.(clientMessageId);} }, accepted: observation => publish(generation,observation) });
  }, observe(sender, observation, generation) {
    if (sameSender(sender, lifetime.current.scope)) publish(generation,observation);
  } }; }, [key, forwardedProps, publish]);
  return <Context.Provider value={port}>{children}</Context.Provider>;
}

export type HostRunAttempt = Readonly<{ context: FrozenHostRunContext | null; forwardedProps: Readonly<Record<string, unknown>>; isCurrent: (resolvedThreadId?: string | null) => boolean }>;
/** Ordinary Chat stays optional; a retry explicitly retains its original selector or absence. */
export function useHostRunContext(sender: HostRunSenderScope) {
  const port = React.useContext(Context);
  const { orgId, userId, sessionToken, projectId, threadId } = sender;
  const stableSender = React.useMemo(() => ({ orgId, userId, sessionToken, projectId, threadId }), [orgId, userId, sessionToken, projectId, threadId]);
  const key = JSON.stringify(scopeKeys.map(field => sender[field] ?? null));
  const lifetime = React.useRef({ key, generation: 0, active: true, sender });
  if (lifetime.current.key !== key) lifetime.current.generation++;
  Object.assign(lifetime.current, { key, sender });
  React.useEffect(() => { const owner = lifetime.current; owner.active = true; return () => { owner.active = false; }; }, []);
  const capture = React.useCallback((retry?: FrozenHostRunContext | null): HostRunAttempt => {
    const snapshot = retry === undefined ? port?.capture(stableSender) ?? null : retry;
    if (snapshot && (!port || !snapshot.matches(stableSender))) throw new Error("HOST_RUN_CONTEXT_UNAVAILABLE");
    if (retry) port?.capture(stableSender); // Readiness can pause a retry, but never replace its frozen data.
    const generation = lifetime.current.generation;
    return { context: snapshot, forwardedProps: snapshot?.forwardedProps ?? {}, isCurrent: resolved => snapshot === null || (lifetime.current.active && lifetime.current.generation === generation && snapshot.matches(lifetime.current.sender) && (resolved === undefined || resolved === snapshot.threadId)) };
  }, [port, stableSender]);
  const observeRun = React.useCallback((observation: HostRunObservation) => { if (lifetime.current.active && sameSender(lifetime.current.sender, stableSender)) port?.observe(stableSender, observation, port.generation); }, [port, stableSender]);
  return { capture, present: port !== null, observeRun, lifecycleKey:JSON.stringify([key,port?.generation ?? null]) };
}
