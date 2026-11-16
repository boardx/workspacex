import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-attach", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/components/session/session-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/session/session-provider")>()),
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
vi.mock("@/lib/use-asr-draft", () => ({
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));

import * as React from "react";
import { CopilotKit, useCopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import { HostRunContextProvider, HOST_RUN_BUSY, HOST_RUN_CONTEXT_UNAVAILABLE } from "@/lib/chat/host-run-context";

const THREAD_ID = "thr-live-failure";
const RUN_ID = "run-live-1";

/** jsdom 里没有 WebSocket；恢复订阅只需要一个不推任何事件的空壳（本条不走恢复路径）。 */
class SilentWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1;
  static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 1;
  constructor(readonly url: string, readonly protocols?: string[]) { super(); }
  send(): void {}
  close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

/**
 * 拿到这次挂载真实的 `CopilotKitCore` 实例，供测试从**它自己的**错误总线发事件。
 * `emitError` 在 `.d.ts` 里是 TS-private，运行时就是 `CopilotKitCore` 上的普通方法
 * （`core/dist/index.mjs`：`async emitError({error, code, context}) { notifySubscribers(...onError...) }`）——
 * core 自己的 `createAgentErrorSubscriber` 收到 AG-UI `RUN_ERROR` 时调的正是它。
 */
type ErrorBus = {
  runAgent(input: unknown): Promise<void>;
  emitError(params: { error: Error; code: string; context?: Record<string, unknown> }): Promise<void>;
};
type AgentLike = { subscribers: Array<{ onCustomEvent?: (params: { event: unknown }) => void; onRunStartedEvent?: (params: unknown) => void }> };
let errorBus: ErrorBus | null = null;
let agents: Readonly<Record<string, AgentLike>> = {};
function CoreProbe(): null {
  const { copilotkit } = useCopilotKit();
  React.useEffect(() => {
    errorBus = copilotkit as unknown as ErrorBus;
    agents = (copilotkit as unknown as { agents: Readonly<Record<string, AgentLike>> }).agents;
  });
  return null;
}

/**
 * 让面板知道「当前这一轮是哪个 run」——发一条**真实形状**的 durable execution 事件
 * （`AGUI_EXECUTION_EVENT_NAME` + `{ runId, kind: "status", status: "running" }`，
 * 与 `copilotkit-agui.controller.ts` 接受 run 后写上 wire 的那条逐字同形），
 * 走的是面板自己那份 `useRunTrace` 订阅，不是测试另塞一个 state。
 */
function emitRunAccepted(runId: string): void {
  const event = {
    name: "execution_event",
    value: { runId, seq: 0, kind: "status", status: "running", emittedAt: "2026-09-10T00:00:00.000Z" },
  };
  for (const agent of Object.values(agents)) {
    for (const subscriber of agent.subscribers ?? []) subscriber.onCustomEvent?.({ event });
  }
}


const SCOPE = { orgId:"org-1", userId:"u", sessionToken:"b", projectId:"p",threadId:THREAD_ID,task:"stage:2" };
const selector=(revision:number)=>({aidtContext:{schemaVersion:1,projectId:"p",purpose:"stage",stageId:2,stageRevisions:[{stageId:1,revision}]}});
const fetcher=vi.fn();
function Mount({revision=1,ready=true,accepted=()=>{}}:{revision?:number;ready?:boolean;accepted?:(value:unknown)=>void}) {
 return <HostRunContextProvider scope={SCOPE} forwardedProps={ready?selector(revision):null} onRunAccepted={accepted}><CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}><CopilotKitV2AgentSelectionProvider><CoreProbe/><CopilotKitV2Panel chatThreadId={THREAD_ID} projectId="p" archived={false} canGeneratePersona={false}/></CopilotKitV2AgentSelectionProvider></CopilotKit></HostRunContextProvider>;
}
function start() { for(const agent of Object.values(agents)) for(const subscriber of agent.subscribers??[]) subscriber.onRunStartedEvent?.({input:{threadId:THREAD_ID,runId:"client-only-not-server-id"},event:{type:"RUN_STARTED",threadId:THREAD_ID,runId:"client-only-not-server-id"}}); }
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();localStorage.clear();errorBus=null;agents={};vi.stubGlobal("WebSocket",SilentWebSocket);window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY,"b");listMessages.mockResolvedValue({messages:[],nextCursor:null});getAgentRun.mockRejectedValue(new Error("NO_RESTORATION"));fetcher.mockImplementation(async()=>new Response(JSON.stringify({reasonCode:"NOT_FOUND"}),{status:404,headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetcher);});
it("native banner retry retains the original exact selector/id while a fresh send uses updated selection and verbatim student text",async()=>{
 const view=render(<Mount/>);await waitFor(()=>expect(errorBus).not.toBeNull());
 const run=vi.spyOn(errorBus!,"runAgent").mockRejectedValue(new Error("MODEL_CALL_FAILED"));
 const input=await screen.findByTestId("copilotkit-v2-input");fireEvent.change(input,{target:{value:"学生原话：不要替我改写。"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await waitFor(()=>expect(run).toHaveBeenCalledTimes(1));
 const original=run.mock.calls[0]![0] as {forwardedProps:Record<string,unknown>;agent:{messages:{role:string;content:string}[]}};
 expect(original.forwardedProps).toEqual({...selector(1),chatThreadId:THREAD_ID,clientMessageId:expect.any(String)});expect(original.agent.messages.some(m=>m.role==="user"&&m.content==="学生原话：不要替我改写。")).toBe(true);
 await screen.findByTestId("copilotkit-v2-retry");view.rerender(<Mount revision={7}/>);expect(screen.getByTestId("copilotkit-v2-input")).toBe(input);fireEvent.click(screen.getByTestId("copilotkit-v2-retry"));await waitFor(()=>expect(run).toHaveBeenCalledTimes(2));expect((run.mock.calls[1]![0] as typeof original).forwardedProps).toEqual(original.forwardedProps);
 fireEvent.change(input,{target:{value:"新的明确问题"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await waitFor(()=>expect(run).toHaveBeenCalledTimes(3));expect((run.mock.calls[2]![0] as typeof original).forwardedProps).toMatchObject(selector(7));expect((run.mock.calls[2]![0] as typeof original).forwardedProps.clientMessageId).not.toBe(original.forwardedProps.clientMessageId);run.mockRestore();
});
it("an unready host retains the actual composer draft and never silently dispatches an ordinary run",async()=>{
 render(<Mount ready={false}/>);await waitFor(()=>expect(errorBus).not.toBeNull());const run=vi.spyOn(errorBus!,"runAgent").mockResolvedValue();const input=await screen.findByTestId("copilotkit-v2-input");fireEvent.change(input,{target:{value:"材料尚未就绪时的原稿"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await screen.findByText(HOST_RUN_CONTEXT_UNAVAILABLE);expect(input).toHaveValue("材料尚未就绪时的原稿");expect(run).not.toHaveBeenCalled();run.mockRestore();
});
it("busy host rejects both native send and queue before clearing the draft or making any queue POST",async()=>{
 render(<Mount/>);await waitFor(()=>expect(Object.keys(agents).length).toBeGreaterThan(0));const run=vi.spyOn(errorBus!,"runAgent").mockResolvedValue();await act(async()=>{start();emitRunAccepted(RUN_ID);});await screen.findByTestId("copilotkit-v2-running-indicator");const input=await screen.findByTestId("copilotkit-v2-input");fireEvent.change(input,{target:{value:"运行期间保留这份学生草稿"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await screen.findByText(HOST_RUN_BUSY);expect(input).toHaveValue("运行期间保留这份学生草稿");fireEvent.click(screen.getByTestId("workbench-queue-next-turn"));expect(input).toHaveValue("运行期间保留这份学生草稿");expect(run).not.toHaveBeenCalled();expect(fetcher.mock.calls.filter(([url,options])=>String(url).includes("queue")&&options?.method==="POST")).toHaveLength(0);expect(Object.keys(sessionStorage).filter(k=>k.startsWith("workbench-queued-replies:")).every(k=>!Object.values(JSON.parse(sessionStorage.getItem(k)!)).some(q=>Array.isArray(q)&&q.length))).toBe(true);run.mockRestore();
});
it("observes only the persisted execution run id after dispatch, not the SDK correlation id",async()=>{
 const accepted=vi.fn();render(<Mount accepted={accepted}/>);await waitFor(()=>expect(errorBus).not.toBeNull());let finish!:()=>void;const run=vi.spyOn(errorBus!,"runAgent").mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const input=await screen.findByTestId("copilotkit-v2-input");fireEvent.change(input,{target:{value:"请讨论这个问题"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await waitFor(()=>expect(run).toHaveBeenCalledOnce());await act(async()=>{start();});expect(accepted).not.toHaveBeenCalled();await act(async()=>{emitRunAccepted(RUN_ID);});await waitFor(()=>expect(accepted).toHaveBeenCalledWith({runId:RUN_ID,threadId:THREAD_ID,clientMessageId:expect.any(String)}));expect(accepted).toHaveBeenCalledOnce();await act(async()=>finish());run.mockRestore();
});

it("native timeline failure retry also retains the frozen selector and client message id",async()=>{
 const view=render(<Mount/>);await waitFor(()=>expect(errorBus).not.toBeNull());let finish!:()=>void;const run=vi.spyOn(errorBus!,"runAgent").mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;})).mockResolvedValue();const input=await screen.findByTestId("copilotkit-v2-input");fireEvent.change(input,{target:{value:"原始学生问题"}});fireEvent.click(screen.getByTestId("copilotkit-v2-send"));await waitFor(()=>expect(run).toHaveBeenCalledOnce());const initial=(run.mock.calls[0]![0] as {forwardedProps:unknown}).forwardedProps;
 await act(async()=>{start();emitRunAccepted(RUN_ID);});await screen.findByTestId("copilotkit-v2-running-indicator");getAgentRun.mockResolvedValue({runId:RUN_ID,threadId:THREAD_ID,status:"failed",error:"MODEL_CALL_FAILED",failureReason:null,resultMessageId:null});await act(async()=>{await errorBus!.emitError({error:new Error("MODEL_CALL_FAILED"),code:"agent_run_error_event",context:{source:"onRunErrorEvent",runtimeErrorCode:"MODEL_CALL_FAILED"}});});await act(async()=>{for(const agent of Object.values(agents))for(const subscriber of agent.subscribers??[])subscriber.onCustomEvent?.({event:{name:"execution_event",value:{runId:RUN_ID,seq:1,kind:"status",status:"failed",emittedAt:"2026-09-10T00:00:01.000Z"}}});finish();});await screen.findByTestId("copilotkit-v2-retry");view.rerender(<Mount revision={9}/>);const trace=screen.getByTestId("run-trace-panel");fireEvent.click(within(trace).getByRole("button",{name:"重试"}));await waitFor(()=>expect(run).toHaveBeenCalledTimes(2));expect((run.mock.calls[1]![0] as {forwardedProps:unknown}).forwardedProps).toEqual(initial);run.mockRestore();
});
