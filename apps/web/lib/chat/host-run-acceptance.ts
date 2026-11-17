"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { operations } from "@repo/contracts/chat";
import { ApiError } from "@/lib/api-client";
import { listMessages } from "@/lib/live-chat";
import type { HostRunAttempt } from "./host-run-context";

export const HOST_ACCEPTANCE_BUDGET = { timeoutMs: 25_000, attempts: 40, pages: 10, pageSize: 100, retryMs: 500 } as const;
type Lookup = { threadId: string; clientMessageId: string; actorId: string; text: string; sessionToken: string; signal: AbortSignal; isCurrent: () => boolean };
function bounded<T>(task: Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("HOST_ACCEPTANCE_CANCELLED")); };
    const timer = setTimeout(abort, Math.max(0, deadline-Date.now()));
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    task.then(value => { cleanup(); resolve(value); }, cause => { cleanup(); reject(cause); });
  });
}
/** An authorized exact human-message read, never a latest-message or timestamp guess. */
export async function readHostRunAcceptance(input: Lookup): Promise<string | null> {
  const deadline=Date.now()+HOST_ACCEPTANCE_BUDGET.timeoutMs;
  const current=()=>!input.signal.aborted && input.isCurrent() && Date.now()<deadline;
  for(let attempt=0;attempt<HOST_ACCEPTANCE_BUDGET.attempts && current();attempt++) {
    let cursor:string|undefined; const seen=new Set<string>();
    try {
      for(let page=0;page<HOST_ACCEPTANCE_BUDGET.pages && current();page++) {
        const result=operations.listMessages.out.parse(await bounded(listMessages(input.threadId,{limit:HOST_ACCEPTANCE_BUDGET.pageSize,...(cursor?{cursor}:{})},input.sessionToken),input.signal,deadline));
        if(!current()) return null;
        const matches=result.messages.filter(row=>row.authorKind==="human" && row.authorId===input.actorId && row.clientMessageId===input.clientMessageId);
        if(matches.some(row=>row.text!==input.text) || matches.length>1) return null;
        if(matches[0]?.agentRunId?.trim()) return matches[0].agentRunId;
        if(result.nextCursor===null) break;
        if(seen.has(result.nextCursor) || page===HOST_ACCEPTANCE_BUDGET.pages-1) return null;
        seen.add(result.nextCursor); cursor=result.nextCursor;
      }
    } catch(cause) {
      if(!current() || cause instanceof ApiError && [401,403,404].includes(cause.status)) return null;
    }
    if(!current() || attempt===HOST_ACCEPTANCE_BUDGET.attempts-1) return null;
    try { await bounded(new Promise<void>(resolve=>setTimeout(resolve,HOST_ACCEPTANCE_BUDGET.retryMs)),input.signal,deadline); } catch { return null; }
  }
  return null;
}

type Pending = Lookup & { attempt: HostRunAttempt; sdkRunId: string | null; signalOwner:AbortController; reading:boolean };
/** RUN_STARTED is only an acceptance gate; its correlation ID is never a backend run ID. */
export function useHostRunAcceptance(agent: AbstractAgent, lifecycleKey: string) {
  const pending=React.useRef<Pending|null>(null);
  const cancel=React.useCallback((clientMessageId?:string)=>{ if(!clientMessageId || pending.current?.clientMessageId===clientMessageId) { pending.current?.signalOwner.abort(); pending.current=null; } },[]);
  React.useEffect(()=>()=>cancel(),[lifecycleKey,cancel]);
  React.useEffect(()=>{
    const matches=(input:{forwardedProps?:unknown})=>{ const owner=pending.current,props=input.forwardedProps as Record<string,unknown>|undefined; return owner && props?.clientMessageId===owner.clientMessageId && props.chatThreadId===owner.threadId && owner.isCurrent()?owner:null; };
    return agent.subscribe({
      onRunInitialized:({input})=>{ const owner=matches(input); if(owner) owner.sdkRunId=input.runId; },
      onRunStartedEvent:({input,event})=>{
        const owner=matches(input); if(!owner || owner.sdkRunId!==input.runId || event.runId!==owner.sdkRunId || owner.reading) return;
        owner.reading=true;
        void readHostRunAcceptance(owner).then(runId=>{ if(runId && pending.current===owner && owner.isCurrent()) owner.attempt.context?.accepted({runId,threadId:owner.threadId,clientMessageId:owner.clientMessageId}); }).finally(()=>{if(pending.current===owner)pending.current=null;});
      },
      onRunErrorEvent:({input})=>{const owner=matches(input);if(owner && owner.sdkRunId===input.runId)cancel(owner.clientMessageId);},
    }).unsubscribe;
  },[agent,cancel]);
  const prepare=React.useCallback((input:Omit<Lookup,"signal"|"isCurrent"> & {attempt:HostRunAttempt})=>{
    cancel(); if(!input.attempt.context) return;
    const signalOwner=new AbortController();
    const owner:Pending={...input,signalOwner,signal:signalOwner.signal,sdkRunId:null,reading:false,isCurrent:()=>pending.current===owner && input.attempt.isCurrent(input.threadId)};
    pending.current=owner;
  },[cancel]);
  return {prepare,cancel};
}
