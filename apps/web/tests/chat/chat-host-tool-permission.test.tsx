/**
 * issue #2774（`/chat` 接入 F08 四选一工具权限卡，退役 `useHumanInTheLoop`/
 * `SendEmailApprovalDialog`）——模式与 `tests/chat/chat-host-interjection.test.tsx`
 * （issue #2756）逐条对齐：① 真实 `CopilotKitV2Panel` 宿主级，钉住"卡片只在
 * `awaiting_tool_permission` 出现、展示真实 `pendingApproval` 数据、裁决走真实
 * `decideToolPermission`、成功后卡片随状态离开自然收起"；② hook 层
 * （`useChatHostPendingToolPermission`）单独钉住"有界重试"；③ 组件层
 * （`ChatHostToolPermission`）单独钉住 a11y 播报与失败重试。
 *
 * 全仓 `copilotkit-v2-hitl-dialog`/`SendEmailApprovalDialog`/`useHumanInTheLoop`（工具权限
 * 场景）引用应为 0——本文件不直接断言这件事（那是全仓 grep 的活，不是单测的活），但
 * 三段测试合起来证明：新卡片就是唯一能裁决 `awaiting_tool_permission` 的入口。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const {
  listMessages, getAgentRun, decideToolPermission, createPersonalThread, listCapabilities,
} = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  decideToolPermission: vi.fn(),
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
  getAgentRun, decideToolPermission,
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
import { useChatHostPendingToolPermission } from "@/lib/chat-host-tool-permission-run";
import { ChatHostToolPermission } from "@/components/chat/chat-host-tool-permission";

const THREAD_ID = "thr-2774";
const RUN_ID = "run-1";

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

function msg(id: string, authorKind: "human" | "agent", text: string, extra: { agentRunId?: string | null; replyToMessageId?: string | null } = {}) {
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
  listMessages.mockImplementation(async () => ({
    messages: [msg("cm-1", "human", "帮我把这份纪要生成一份 PDF", { agentRunId: RUN_ID })],
    nextCursor: null,
  }));
  getAgentRun.mockResolvedValue({
    runId: RUN_ID, threadId: THREAD_ID, status: "awaiting_tool_permission", error: null, resultMessageId: null,
    pendingApproval: { toolName: "call_skill", argsSummary: '{"skill_stable_name":"pdf-create"}' },
  });
  decideToolPermission.mockResolvedValue({ runId: RUN_ID, toolCallId: "call_skill" });
});

/* ── ① 宿主：真实 CopilotKitV2Panel + awaiting_tool_permission ────────────── */

describe("/chat 宿主 · awaiting_tool_permission ⇒ 工具权限卡可用（issue #2774）", () => {
  it("网关推 status_change(awaiting_tool_permission) 后卡片出现，展示真实 toolName；裁决走真实 decideToolPermission，成功后卡片收起", async () => {
    mountHost();
    await screen.findByTestId("copilotkit-v2-running-indicator");
    expect(screen.queryByTestId("tool-permission-card")).not.toBeInTheDocument();

    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0]!.emit(statusChange("awaiting_tool_permission")));

    const card = await screen.findByTestId("tool-permission-card");
    expect(card).toBeInTheDocument();
    await waitFor(() => expect(getAgentRun).toHaveBeenCalledWith(RUN_ID, "b"));
    expect(screen.getByTestId("perm-intent")).toHaveTextContent("call_skill");
    expect(screen.getByTestId("chat-host-tool-permission").getAttribute("data-run-id")).toBe(RUN_ID);

    fireEvent.click(screen.getByTestId("perm-once"));
    await waitFor(() => expect(decideToolPermission).toHaveBeenCalledWith(RUN_ID, "call_skill", "once", "b"));
    await screen.findByTestId("saved");

    // 卡片本身不自己乐观卸载——收起要等 run 状态真的离开 awaiting_tool_permission。
    expect(screen.getByTestId("tool-permission-card")).toBeInTheDocument();
    act(() => sockets[0]!.emit(statusChange("running", 2)));
    await waitFor(() => expect(screen.queryByTestId("tool-permission-card")).not.toBeInTheDocument());
  });

  it("对照组：running/queued/paused/awaiting_plan_confirmation 均不渲染工具权限卡", async () => {
    mountHost();
    await waitFor(() => expect(sockets.length).toBe(1));

    for (const [status, seq] of [["running", 1], ["queued", 2], ["paused", 3], ["awaiting_plan_confirmation", 4]] as const) {
      act(() => sockets[0]!.emit(statusChange(status, seq)));
      await waitFor(() => expect(screen.queryByTestId("tool-permission-card")).not.toBeInTheDocument());
    }
    expect(getAgentRun).not.toHaveBeenCalled();
  });
});

/* ── ② hook：useChatHostPendingToolPermission ─────────────────────────────── */

describe("useChatHostPendingToolPermission", () => {
  it("status 变为 awaiting_tool_permission ⇒ 读 getAgentRun 拿 pendingApproval；status 离开后清空", async () => {
    const { result, rerender } = renderHook(
      (props: { status: string | null }) => useChatHostPendingToolPermission({
        runId: RUN_ID, status: props.status as never, sessionToken: "b",
      }),
      { initialProps: { status: null as string | null } },
    );
    expect(result.current).toBeNull();

    rerender({ status: "awaiting_tool_permission" });
    await waitFor(() => expect(result.current).toEqual({ toolName: "call_skill", argsSummary: '{"skill_stable_name":"pdf-create"}' }));

    rerender({ status: "running" });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("getAgentRun 持续读不到 pendingApproval（或失败）⇒ 有界重试后如实为 null，不拿假数据顶上", async () => {
    vi.useFakeTimers();
    try {
      getAgentRun.mockResolvedValue({
        runId: RUN_ID, threadId: THREAD_ID, status: "awaiting_tool_permission", error: null,
        resultMessageId: null, pendingApproval: null,
      });
      const { result } = renderHook(() => useChatHostPendingToolPermission({
        runId: RUN_ID, status: "awaiting_tool_permission", sessionToken: "b",
      }));
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(getAgentRun).toHaveBeenCalledTimes(3);
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── ③ 组件：ChatHostToolPermission 单独钉住 a11y 与失败重试 ──────────────── */

describe("ChatHostToolPermission", () => {
  it("runId/status 为 null 或非 awaiting_tool_permission ⇒ 不渲染", () => {
    render(<ChatHostToolPermission runId={null} status="running" sessionToken="b" />);
    expect(screen.queryByTestId("chat-host-tool-permission")).not.toBeInTheDocument();
  });

  it("裁决失败：card 展示 perm-error，不假装决定生效，composer 焦点不被打断", async () => {
    decideToolPermission.mockRejectedValue(new Error("boom"));
    render(<ChatHostToolPermission runId={RUN_ID} status="awaiting_tool_permission" sessionToken="b" />);
    await screen.findByTestId("tool-permission-card");

    fireEvent.click(screen.getByTestId("perm-deny"));
    await screen.findByTestId("perm-error");
    expect(screen.queryByTestId("saved")).not.toBeInTheDocument();
    expect(screen.getByTestId("perm-deny")).toBeEnabled();
  });

  it("TW-A11Y-4：卡片出现时通过 live region 播报需要批准", async () => {
    const { ChatLiveAnnouncer, announceToChat } = await import("@/components/chat/chat-live-announcer");
    // `announceToChat` 是模块级单例 store（见该文件头注"为什么是模块级小 store"），
    // 跨测试用例持久——先清空，否则本断言可能只是读到上一条用例留下的旧播报，
    // 而不是真的验证了这次挂载触发了新播报（vacuous pass）。
    announceToChat("");
    render(
      <>
        <ChatLiveAnnouncer />
        <ChatHostToolPermission runId={RUN_ID} status="awaiting_tool_permission" sessionToken="b" />
      </>,
    );
    await screen.findByTestId("tool-permission-card");
    await waitFor(() => {
      const region = screen.getByRole("status");
      expect(region.textContent).toContain("需要你的批准");
    });
  });
});
