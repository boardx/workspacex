import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useRunningReply } from "@/lib/chat-workbench/use-running-reply";
const interject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-kernel-interject", async importOriginal => ({...await importOriginal<typeof import("@/lib/agent-kernel-interject")>(), interjectAgentRun: interject}));
const agent = { addMessage: vi.fn() } as unknown as AbstractAgent;
describe("queued draft acceptance", () => {
  beforeEach(() => sessionStorage.clear());
  it("persists replies in FIFO order even while the business run is paused", async () => {
    const enqueue = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ text }) => useRunningReply({ agent, threadId: "a", run: { runId: "run", status: "paused" }, inputDraft: text, sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { text: "first" } });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
    rerender({ text: "second" });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual(["first", "second"]);
  });
  it("retains failed text and request identity for retry and isolates another thread", async () => {
    const enqueue = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = renderHook(({ threadId }) => useRunningReply({ agent, threadId, run: { runId: null, status: null }, inputDraft: "keep me", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }), { initialProps: { threadId: "a" } });
    await act(() => result.current.sendWhileRunning());
    await waitFor(() => expect(result.current.queuedFailed).toBe(true));
    expect(result.current.queuedReply).toBe("keep me");
    rerender({ threadId: "b" });
    expect(result.current.queuedReply).toBeNull();
    rerender({ threadId: "a" });
    act(() => result.current.retryQueuedReply());
    await waitFor(() => expect(result.current.queuedReply).toBeNull());
    expect(enqueue.mock.calls[0]![1]).toEqual(enqueue.mock.calls[1]![1]);
  });
  it("restores unacknowledged drafts after refresh without silently submitting again", async () => {
    const enqueue = vi.fn().mockResolvedValue(false);
    const setup = () => useRunningReply({ agent, threadId: "restore", run: { runId: "run", status: "awaiting_tool_permission" }, inputDraft: "local draft", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() });
    const first = renderHook(setup);
    await act(() => first.result.current.sendWhileRunning());
    await waitFor(() => expect(first.result.current.queuedFailed).toBe(true));
    first.unmount();
    const second = renderHook(setup);
    expect(second.result.current.queuedReply).toBe("local draft");
    expect(enqueue).toHaveBeenCalledTimes(1);
    enqueue.mockResolvedValue(true);
    act(() => second.result.current.retryQueuedReply());
    await waitFor(() => expect(second.result.current.queuedReply).toBeNull());
  });
  it("lets the user explicitly queue while a run is running", async () => {
    const enqueue = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useRunningReply({ agent, threadId: "a", run: { runId: "active", status: "running" }, inputDraft: "later", sessionToken: null, enqueue, clearDraft: vi.fn(), setError: vi.fn() }));
    await act(() => result.current.sendWhileRunning({ forceQueue: true }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledWith("later", expect.objectContaining({ clientMessageId: expect.any(String) })));
    expect(result.current.runningReplyAck).toBeNull();
  });

});

it("read-only steering preserves the draft and resumes delivery only after authoritative permission returns", async () => {
  sessionStorage.clear();
  const enqueue=vi.fn().mockResolvedValue(true), clearDraft=vi.fn();
  const {result,rerender}=renderHook(({canWrite})=>useRunningReply({agent,threadId:"permissions",run:{runId:"r",status:"paused"},inputDraft:"follow direction B",sessionToken:null,enqueue,clearDraft,setError:vi.fn(),canWrite}),{initialProps:{canWrite:false}});
  await act(()=>result.current.sendWhileRunning());
  expect(clearDraft).not.toHaveBeenCalled();expect(enqueue).not.toHaveBeenCalled();
  rerender({canWrite:true});
  await act(()=>result.current.sendWhileRunning());
  await waitFor(()=>expect(enqueue).toHaveBeenCalledTimes(1));
});

it("late queue ACK from another tenant cannot remove the current tenant's same-thread draft", async () => {
  sessionStorage.clear();
  sessionStorage.setItem("workbench-queued-replies:org-b",JSON.stringify({same:[{id:"b",text:"B draft"}]}));
  let finish!: (ok:boolean)=>void;
  const enqueue=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(({scope})=>useRunningReply({agent,threadId:"same",draftScope:scope,run:{runId:null,status:null},inputDraft:"A draft",sessionToken:null,enqueue,clearDraft:vi.fn(),setError:vi.fn()}),{initialProps:{scope:"org-a"}});
  await act(()=>result.current.sendWhileRunning());
  await waitFor(()=>expect(enqueue).toHaveBeenCalledTimes(1));
  rerender({scope:"org-b"});
  await waitFor(()=>expect(result.current.queuedReply).toBe("B draft"));
  await act(async()=>finish(true));
  expect(result.current.queuedReply).toBe("B draft");
  expect(result.current.queuedFailed).toBe(true);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("running direction is submitted as an interjection without stopping or queuing the current tool", async () => {
  sessionStorage.clear(); vi.clearAllMocks();
  interject.mockResolvedValue({interjectionId:"accepted-direction"});
  const enqueue=vi.fn(),clearDraft=vi.fn();
  const {result}=renderHook(()=>useRunningReply({agent,threadId:"running",draftScope:"org-a",run:{runId:"active-run",status:"running"},inputDraft:"改为 B",sessionToken:"test-token",enqueue,clearDraft,setError:vi.fn(),canWrite:true}));
  await act(()=>result.current.sendWhileRunning());
  expect(interject).toHaveBeenCalledWith({runId:"active-run",text:"改为 B"},{sessionToken:"test-token"});
  expect(enqueue).not.toHaveBeenCalled();
  expect(agent.addMessage).toHaveBeenCalledWith({id:"interjection:accepted-direction",role:"user",content:"改为 B"});
  expect(result.current.runningReplyAck).not.toBeNull();
});
it("a late interjection ACK cannot clear or append into another tenant's same-thread view", async () => {
  sessionStorage.clear(); vi.clearAllMocks();
  let finish!: (value:{interjectionId:string})=>void;
  interject.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const clearDraft=vi.fn();
  const {result,rerender}=renderHook(({scope})=>useRunningReply({agent,threadId:"same",draftScope:scope,run:{runId:"running",status:"running"},inputDraft:"private A",sessionToken:scope,enqueue:vi.fn(),clearDraft,setError:vi.fn()}),{initialProps:{scope:"org-a"}});
  let pending!:Promise<void>;
  act(()=>{pending=result.current.sendWhileRunning();});
  rerender({scope:"org-b"});
  await act(async()=>{finish({interjectionId:"old"});await pending;});
  expect(clearDraft).not.toHaveBeenCalled();
  expect(agent.addMessage).not.toHaveBeenCalled();
  expect(result.current.runningReplyAck).toBeNull();
});
