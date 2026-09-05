/**
 * issue #2756（Phase 14 后续 B）—— `/chat` 宿主接入中途插话入口。
 *
 * F12（`tests/agent-kernel/interjection-composer.test.tsx`）证明的是**组件**契约：给
 * `InterjectionComposer` 一个 `runId` + `running`，它就可交互、1 秒内出 ack。PR #2753
 * 「接线边界」如实记录：`/chat` 宿主从没传过真实 `runId`。本文件钉的是**宿主**契约：
 * 在真实的 `CopilotKitV2Panel`（`/chat` 的宿主屏）里，一个真实在途的 run 会让
 * `interjection-input` 出现且非 disabled，发送走真实 `interjectAgentRun`、1 秒内出
 * `interjection-ack`；非 running 态不渲染入口。
 *
 * 两条路径分别断言（见 `lib/chat-host-interjection-run.ts` 文件头「两条路径、一条 socket」）：
 * ① 恢复路径：复刻 `tests/ui/copilotkit-v2-run-restore-on-remount.test.tsx` 的真实场景——
 *    挂载时 `listMessages` 读到一条带 `agentRunId` 且未回复的人类消息，
 *    `useCopilotKitV2RunRestore` 订阅事件流；网关推 `status_change("running")` 后入口出现。
 *    同时钉住「一条 socket」：宿主没有为插话再开第二条订阅。
 * ② 在途路径：`renderHook` + 替身 agent，`RUN_STARTED` 后 hook 去读落库消息解析真实
 *    runId、订阅事件流拿 status；`RUN_FINISHED` 后收起。
 *
 * 反空转：
 * - 「1 秒内」用 `findByTestId` 显式 1000ms 上限（R9），不是靶心画在箭上。
 * - 对照组：同一宿主、同一 run，`status_change("awaiting_tool_permission")` ⇒ 入口不在；
 *   还没收到任何状态事件 ⇒ 入口不在（宿主不编一个默认 `running`）。
 * - 发送断言 `interjectAgentRun` 收到的是**真实** `agent_runs.id`（`run-1`，来自落库消息的
 *   `agentRunId`），不是 AG-UI 的客户端 correlation id。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities, interjectAgentRun } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-attach", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
  interjectAgentRun: vi.fn(),
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
vi.mock("@/lib/agent-kernel-interject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-kernel-interject")>()),
  interjectAgentRun,
}));
vi.mock("@/components/session/session-provider", () => ({
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

import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import { useChatHostInterjectionRun } from "@/lib/chat-host-interjection-run";
import { ChatHostInterjection } from "@/components/chat/chat-host-interjection";

const THREAD_ID = "thr-2756";
const RUN_ID = "run-1";
const RECEIVED_AT = "2026-09-05T08:00:00.000Z";

/** 同 `copilotkit-v2-run-restore-on-remount.test.tsx` 的 `FakeWebSocket`——顶替浏览器原生
 *  `WebSocket`，测试用 `emit` 模拟网关推来的 `KernelStreamEvent`。 */
class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  constructor(readonly url: string, readonly protocols: string[]) { super(); }
  send(): void {}
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  emit(payload: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}
let sockets: FakeWebSocket[] = [];

function statusChange(status: string, seq = 1) {
  return { type: "status_change", runId: RUN_ID, seq, status, pausedBy: null, emittedAt: "2026-09-05T00:00:00.000Z" };
}

function msg(
  id: string,
  authorKind: "human" | "agent",
  text: string,
  extra: { agentRunId?: string | null; replyToMessageId?: string | null } = {},
) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId: extra.agentRunId ?? null, replyToMessageId: extra.replyToMessageId ?? null,
    createdAt: "2026-09-05T00:00:00.000Z",
  };
}

function mountHost() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sockets = [];
  vi.stubGlobal("WebSocket", class extends FakeWebSocket {
    constructor(url: string, protocols: string[]) {
      super(url, protocols);
      sockets.push(this);
      queueMicrotask(() => this.open());
    }
  });
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  // 一条带 `agentRunId` 且尚未被回复的人类消息 ⇒ `findPendingRunId` = run-1（真实 `agent_runs.id`）。
  listMessages.mockImplementation(async () => ({
    messages: [msg("cm-1", "human", "帮我把这份纪要生成一份 PDF", { agentRunId: RUN_ID })],
    nextCursor: null,
  }));
  getAgentRun.mockResolvedValue({ runId: RUN_ID, threadId: THREAD_ID, status: "running", error: null, resultMessageId: null });
  interjectAgentRun.mockImplementation(async (input: { runId: string; text: string }) => ({
    runId: input.runId, interjectionId: "ij-1", receivedAt: RECEIVED_AT,
  }));
});

/* ── ① 宿主：真实 CopilotKitV2Panel + 在途 run（恢复路径）────────────────── */

describe("/chat 宿主 · 在途 run 为 running ⇒ 插话入口可用（issue #2756）", () => {
  it("网关推来 status_change(running) 后出现 interjection-input 且非 disabled；发送走真实 runId，1 秒内出现 interjection-ack", async () => {
    mountHost();

    await screen.findByTestId("copilotkit-v2-running-indicator");
    // 还没收到任何状态事件：宿主不编一个默认 `running`，入口不在。
    expect(screen.queryByTestId("interjection-input")).not.toBeInTheDocument();

    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0]!.emit(statusChange("running")));

    const input = await screen.findByTestId("interjection-input");
    expect(input).not.toBeDisabled();
    // 入口挂在真实进度指示下方，作兄弟节点——进度指示没有被替换掉。
    expect(screen.getByTestId("copilotkit-v2-running-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("chat-host-interjection").getAttribute("data-run-id")).toBe(RUN_ID);

    fireEvent.change(input, { target: { value: "先别写结论，把数据表补全" } });
    fireEvent.click(screen.getByTestId("interjection-send"));

    // R9：1 秒内出现「已收到」——上限显式写死 1000ms。
    const ack = await screen.findByTestId("interjection-ack", {}, { timeout: 1000 });
    expect(ack.getAttribute("data-received-at")).toBe(RECEIVED_AT);
    expect(interjectAgentRun).toHaveBeenCalledTimes(1);
    const [calledInput, calledOpts] = interjectAgentRun.mock.calls[0]!;
    expect(calledInput).toEqual({ runId: RUN_ID, text: "先别写结论，把数据表补全" });
    expect(calledOpts).toMatchObject({ sessionToken: "b" });

    // 进度指示仍在：插话没有打断当前展示的进度流。
    expect(screen.getByTestId("copilotkit-v2-running-indicator")).toBeInTheDocument();
    // 「一条 socket」：宿主没有为插话入口再开第二条订阅。
    expect(sockets.length).toBe(1);
  });

  it("对照组：status_change(awaiting_tool_permission) ⇒ 不渲染入口；回到 running 又出现", async () => {
    mountHost();
    await waitFor(() => expect(sockets.length).toBe(1));

    act(() => sockets[0]!.emit(statusChange("awaiting_tool_permission", 1)));
    await screen.findByTestId("copilotkit-v2-running-indicator");
    expect(screen.queryByTestId("interjection-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-host-interjection")).not.toBeInTheDocument();

    act(() => sockets[0]!.emit(statusChange("running", 2)));
    await screen.findByTestId("interjection-input");

    act(() => sockets[0]!.emit(statusChange("paused", 3)));
    await waitFor(() => expect(screen.queryByTestId("interjection-input")).not.toBeInTheDocument());
  });

  it("终态 status_change(succeeded) ⇒ 入口收起（不留一个点了必 409 的输入框）", async () => {
    mountHost();
    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0]!.emit(statusChange("running", 1)));
    await screen.findByTestId("interjection-input");

    act(() => sockets[0]!.emit(statusChange("succeeded", 2)));
    await waitFor(() => expect(screen.queryByTestId("interjection-input")).not.toBeInTheDocument());
  });
});

/* ── ② hook：在途路径（本次挂载里刚发的一轮，RUN_STARTED → 落库消息 → 事件流）──── */

type Subscriber = {
  onRunStartedEvent?: () => void;
  onRunFinishedEvent?: () => void;
  onRunErrorEvent?: () => void;
};

function fakeAgent(): { agent: AbstractAgent; subscribers: Subscriber[] } {
  const subscribers: Subscriber[] = [];
  const agent = {
    subscribe(subscriber: Subscriber) {
      subscribers.push(subscriber);
      return { unsubscribe: () => { subscribers.splice(subscribers.indexOf(subscriber), 1); } };
    },
  } as unknown as AbstractAgent;
  return { agent, subscribers };
}

const NO_RESTORE = { runId: null, status: null } as const;

describe("useChatHostInterjectionRun · 在途路径：RUN_STARTED 后解析真实 runId 并订阅状态", () => {
  it("RUN_STARTED ⇒ 读落库消息取 pendingRunId（不是 AG-UI correlation id）⇒ 订阅事件流 ⇒ status 跟随 status_change", async () => {
    const { agent, subscribers } = fakeAgent();
    const { result, rerender } = renderHook(
      (props: { isRunning: boolean; threadId: string | null }) => useChatHostInterjectionRun({
        agent, isRunning: props.isRunning, threadId: props.threadId, sessionToken: "b", restore: NO_RESTORE,
      }),
      { initialProps: { isRunning: false, threadId: null as string | null } },
    );
    expect(result.current).toEqual({ runId: null, status: null });
    expect(subscribers.length).toBe(1);

    // AG-UI：RUN_STARTED 到达，isRunning 为真；chat_thread_id 随后把线程 id resolve 出来。
    act(() => subscribers[0]!.onRunStartedEvent?.());
    rerender({ isRunning: true, threadId: THREAD_ID });

    await waitFor(() => expect(result.current.runId).toBe(RUN_ID));
    expect(listMessages).toHaveBeenCalledWith(THREAD_ID, expect.anything(), "b");
    // runId 已解析但还没收到状态事件：status 如实为 null（宿主不会在此时渲染入口）。
    expect(result.current.status).toBeNull();

    await waitFor(() => expect(sockets.length).toBe(1));
    expect(sockets[0]!.url).toContain(`/agent-runs/${RUN_ID}/events`);
    act(() => sockets[0]!.emit(statusChange("running")));
    await waitFor(() => expect(result.current.status).toBe("running"));

    act(() => sockets[0]!.emit(statusChange("awaiting_tool_permission", 2)));
    await waitFor(() => expect(result.current.status).toBe("awaiting_tool_permission"));

    // RUN_FINISHED ⇒ 收起：runId/status 清空，订阅关闭。
    act(() => subscribers[0]!.onRunFinishedEvent?.());
    await waitFor(() => expect(result.current).toEqual({ runId: null, status: null }));
    expect(sockets[0]!.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("落库行还没到（findPendingRunId 为 null）⇒ 有界重试后仍如实为 null，不拿别的 id 顶上", async () => {
    vi.useFakeTimers();
    try {
      listMessages.mockImplementation(async () => ({ messages: [], nextCursor: null }));
      const { agent, subscribers } = fakeAgent();
      const { result } = renderHook(() => useChatHostInterjectionRun({
        agent, isRunning: true, threadId: THREAD_ID, sessionToken: "b", restore: NO_RESTORE,
      }));
      act(() => subscribers[0]!.onRunStartedEvent?.());
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(listMessages).toHaveBeenCalledTimes(3);
      expect(result.current).toEqual({ runId: null, status: null });
      expect(sockets.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("恢复路径：没有在途 runId 时透传 restore 的 runId/status（同一条订阅，不自己再开）", () => {
    const { agent } = fakeAgent();
    const { result } = renderHook(() => useChatHostInterjectionRun({
      agent, isRunning: false, threadId: THREAD_ID, sessionToken: "b",
      restore: { runId: RUN_ID, status: "running" },
    }));
    expect(result.current).toEqual({ runId: RUN_ID, status: "running" });
    expect(sockets.length).toBe(0);
    expect(listMessages).not.toHaveBeenCalled();
  });
});

/* ── ③ 宿主组件本身：只在 running 渲染，interject 带 bearer ──────────────── */

describe("ChatHostInterjection · 只在 running 渲染", () => {
  it.each([
    ["runId 为 null", null, "running"],
    ["status 为 null", RUN_ID, null],
    ["queued", RUN_ID, "queued"],
    ["awaiting_plan_confirmation", RUN_ID, "awaiting_plan_confirmation"],
    ["paused", RUN_ID, "paused"],
  ] as const)("%s ⇒ 不渲染", (_label, runId, status) => {
    render(<ChatHostInterjection runId={runId} status={status} sessionToken="b" />);
    expect(screen.queryByTestId("chat-host-interjection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("interjection-input")).not.toBeInTheDocument();
  });

  it("running ⇒ 渲染 InterjectionComposer，data-testid 原样（interjection-input / interjection-ack）", async () => {
    render(<ChatHostInterjection runId={RUN_ID} status="running" sessionToken="b" />);
    const input = screen.getByTestId("interjection-input");
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "改用表格" } });
    fireEvent.click(screen.getByTestId("interjection-send"));
    await screen.findByTestId("interjection-ack", {}, { timeout: 1000 });
    expect(interjectAgentRun).toHaveBeenCalledWith({ runId: RUN_ID, text: "改用表格" }, { sessionToken: "b" });
  });
});
