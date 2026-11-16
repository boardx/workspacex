import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AbstractAgent } from "@ag-ui/client";
import { ApiError } from "@/lib/api-client";
import { HOST_ACCEPTANCE_BUDGET as B, readHostRunAcceptance, useHostRunAcceptance } from "@/lib/chat/host-run-acceptance";
import type { HostRunAttempt } from "@/lib/chat/host-run-context";
const {read}=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/live-chat",()=>({listMessages:read}));
const id="11111111-1111-4111-8111-111111111111";
const row=(patch:Record<string,unknown>={})=>({id:"stored-human",authorKind:"human",authorId:"student",agentId:null,text:"捕获的原句",clientMessageId:id,agentRunId:"canonical-run",replyToMessageId:null,createdAt:"2026-11-16T00:00:00Z",...patch});
const input=(signal=new AbortController().signal)=>({threadId:"thread",clientMessageId:id,actorId:"student",text:"捕获的原句",sessionToken:"captured-token",signal,isCurrent:()=>true});
beforeEach(()=>{vi.resetAllMocks();read.mockResolvedValue({messages:[],nextCursor:null});});
afterEach(()=>vi.useRealTimers());
it("paginates oldest-first and binds only the exact human author/id/text, keeping the captured token and thread",async()=>{
 read.mockResolvedValueOnce({messages:[row({authorKind:"agent"}),row({authorId:"other-student"}),row({clientMessageId:"22222222-2222-4222-8222-222222222222"})],nextCursor:"next"}).mockResolvedValueOnce({messages:[row()],nextCursor:null});
 expect(await readHostRunAcceptance(input())).toBe("canonical-run");expect(read.mock.calls).toEqual([["thread",{limit:B.pageSize},"captured-token"],["thread",{limit:B.pageSize,cursor:"next"},"captured-token"]]);
});
it("does not bind an old row with the same client id and different human text",async()=>{
 read.mockResolvedValue({messages:[row({text:"旧原话，不是本次发送"})],nextCursor:null});expect(await readHostRunAcceptance(input())).toBeNull();expect(read).toHaveBeenCalledOnce();
});
it.each([401,403,404])("stops on authorized-read denial %i and never treats it as empty",async status=>{
 read.mockRejectedValue(new ApiError(status,"FORBIDDEN",{}));expect(await readHostRunAcceptance(input())).toBeNull();expect(read).toHaveBeenCalledOnce();
});
it("returns unknown on repeated cursors or the page budget instead of choosing a different message",async()=>{
 read.mockResolvedValue({messages:[],nextCursor:"same"});expect(await readHostRunAcceptance(input())).toBeNull();expect(read).toHaveBeenCalledTimes(2);read.mockClear();let page=0;read.mockImplementation(async()=>({messages:[],nextCursor:`cursor-${++page}`}));expect(await readHostRunAcceptance(input())).toBeNull();expect(read).toHaveBeenCalledTimes(B.pages);
});
it("bounds a hung request and retries with no matching row, and ignores resolution after cancellation",async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const timed=readHostRunAcceptance(input());await vi.advanceTimersByTimeAsync(B.timeoutMs+1);expect(await timed).toBeNull();finish({messages:[row()],nextCursor:null});
 read.mockResolvedValue({messages:[],nextCursor:null});read.mockClear();const exhausted=readHostRunAcceptance(input());await vi.runAllTimersAsync();expect(await exhausted).toBeNull();expect(read.mock.calls.length).toBeLessThanOrEqual(B.attempts);
 const cancellation=new AbortController();read.mockImplementationOnce(()=>new Promise(()=>{}));const cancelled=readHostRunAcceptance(input(cancellation.signal));cancellation.abort();expect(await cancelled).toBeNull();
});
it("drops a response after the actual attempt scope becomes stale",async()=>{
 let finish!:(value:unknown)=>void,current=true;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const task=readHostRunAcceptance({...input(),isCurrent:()=>current});current=false;finish({messages:[row()],nextCursor:null});expect(await task).toBeNull();expect(read).toHaveBeenCalledOnce();
});
function harness(){let subscriber:Record<string,(args:any)=>void>={};const agent={subscribe:(value:typeof subscriber)=>{subscriber=value;return{unsubscribe:()=>{}};}} as unknown as AbstractAgent;const accepted=vi.fn(),context={threadId:"thread",forwardedProps:{},matches:()=>true,started:vi.fn(),accepted};const attempt:HostRunAttempt={context,forwardedProps:{},isCurrent:()=>true};const mounted=renderHook(({scope})=>useHostRunAcceptance(agent,scope),{initialProps:{scope:"A"}});const wire=(runId:string)=>({runId,threadId:"sdk-thread",messages:[],state:{},tools:[],context:[],forwardedProps:{chatThreadId:"thread",clientMessageId:id}});return{mounted,accepted,attempt,get subscriber(){return subscriber;},wire};}
it("waits for this request's server start acknowledgment; ordinary or denied retries do not read old rows",async()=>{
 const h=harness();read.mockResolvedValue({messages:[row()],nextCursor:null});act(()=>h.mounted.result.current.prepare({...input(),attempt:h.attempt}));expect(read).not.toHaveBeenCalled();
 h.subscriber.onRunInitialized!({input:h.wire("new-correlation")});h.subscriber.onRunStartedEvent!({input:h.wire("old-correlation"),event:{runId:"old-correlation"}});expect(read).not.toHaveBeenCalled();h.subscriber.onRunErrorEvent!({input:h.wire("new-correlation")});h.subscriber.onRunStartedEvent!({input:h.wire("new-correlation"),event:{runId:"new-correlation"}});expect(read).not.toHaveBeenCalled();
 act(()=>h.mounted.result.current.prepare({...input(),attempt:{...h.attempt,context:null}}));h.subscriber.onRunInitialized!({input:h.wire("ordinary")});h.subscriber.onRunStartedEvent!({input:h.wire("ordinary"),event:{runId:"ordinary"}});expect(read).not.toHaveBeenCalled();h.mounted.unmount();
});
it("reports queued canonical ids after acknowledgment and cancels a late A→B→A read",async()=>{
 const h=harness();read.mockResolvedValueOnce({messages:[row()],nextCursor:null});act(()=>h.mounted.result.current.prepare({...input(),attempt:h.attempt}));h.subscriber.onRunInitialized!({input:h.wire("sdk-only")});h.subscriber.onRunStartedEvent!({input:h.wire("sdk-only"),event:{runId:"sdk-only"}});await waitFor(()=>expect(h.accepted).toHaveBeenCalledWith({runId:"canonical-run",threadId:"thread",clientMessageId:id}));
 let finish!:(value:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));act(()=>h.mounted.result.current.prepare({...input(),attempt:h.attempt}));h.subscriber.onRunInitialized!({input:h.wire("late-sdk")});h.subscriber.onRunStartedEvent!({input:h.wire("late-sdk"),event:{runId:"late-sdk"}});h.mounted.rerender({scope:"B"});h.mounted.rerender({scope:"A"});await act(async()=>finish({messages:[row({agentRunId:"stale-run"})],nextCursor:null}));expect(h.accepted).toHaveBeenCalledOnce();h.mounted.unmount();
});
