/**
 * session-switch task-state-loss fix —— 用户在一条会话里提交任务（比如"生成 PDF"）后
 * 切到另一个会话再切回来，此前会看不到任何"还在生成"的痕迹：切回即路由级重挂载，
 * `useAgent` 的内存态（`agent.isRunning`/流式内容）与那次挂载绑定的订阅一起被丢弃，
 * 挂载时的 hydration 又只回读已落库消息、不知道"上一轮有没有一个还没写回的 run"
 * （见 `copilotkit-v2-panel.tsx` 挂载 hydration effect 与 `lib/copilotkit-v2-run-restore.ts`
 * 文件头的完整取证）。
 *
 * Phase 14 F04（R6 后置条件）—— 核实机制不再是 REST 轮询，是真实 WebSocket 订阅
 * （`lib/agent-kernel-stream.ts`）：本文件的 `FakeWebSocket` 顶替浏览器原生
 * `WebSocket`，测试通过在它上面 `emit` 一条 `status_change` 事件模拟网关推流，
 * `getAgentRun` 仍然被调用——但只在收到终态事件之后，作为**一次**确认性读
 * （把 `resultMessageId`/`error` 捞出来，见 `copilotkit-v2-run-restore.ts` 文件头）。
 *
 * 这条测试钉在真实的 `CopilotKitV2Panel` 上，复刻"切回"这个真实场景：挂载时
 * `listMessages` 只读到一条尚未回复的人类消息（带 `agentRunId`），断言：
 * ① 挂载后必须显示"生成中"一类指示（不是安静地什么都不显示，看起来像没提交过）；
 * ② 收到终态事件、确认读到终态后，指示消失，服务端这期间真实写回的助手回复被拉回来
 *    渲染出来——不是假装完成，是真的把持久化数据捞回来。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
// 2026-09-02 —— 拉回来的消息必须带真实 `messageId` 到 `MarkdownMessage`（图表 modal 的
// 「保存」/G1 读回靠它判定能否持久化）。此前恢复路径没登记身份索引，`messageId`
// 恒为 undefined ⇒ 保存静默退回本地演示、刷新即丢。
const markdownMessageCalls: Array<{ text: string; messageId: string | undefined }> = [];
vi.mock("@/components/chat/markdown-message", () => ({
  MarkdownMessage: (props: { text: string; messageId?: string }) => {
    markdownMessageCalls.push({ text: props.text, messageId: props.messageId });
    return <div data-testid="markdown-message-probe">{props.text}</div>;
  },
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-restore";

/** 顶替浏览器原生 `WebSocket`——`lib/agent-kernel-stream.ts` 打开的每条订阅都落在这里，
 *  测试用 `emit` 模拟网关推来的 `KernelStreamEvent`（同 `tests/lib/
 *  boardx-realtime-asr-client.test.ts`/`tests/agent-kernel/terminal-status-and-
 *  restore.test.tsx` 同一套注入手法）。 */
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

/** run-1 的终态推流帧——测试只需要改 `status`，其余字段是这条事件类型的必填项。 */
function statusChange(status: "succeeded" | "failed") {
  return {
    type: "status_change", runId: "run-1", seq: 1,
    status, pausedBy: null, emittedAt: "2026-08-30T00:00:00.000Z",
  };
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
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 服务端这期间真实写回的助手回复——只有 run 到终态之后 `listMessages` 才读得到。 */
let writtenBack = false;

beforeEach(() => {
  vi.clearAllMocks();
  markdownMessageCalls.length = 0;
  writtenBack = false;
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
    messages: [
      msg("cm-1", "human", "帮我把这份纪要生成一份 PDF", { agentRunId: "run-1" }),
      ...(writtenBack
        ? [msg("cm-2", "agent", "PDF 已生成，请查收。", { agentRunId: "run-1", replyToMessageId: "cm-1" })]
        : []),
    ],
    nextCursor: null,
  }));
});

describe("copilotkit-v2 切会话再切回 ⇒ 未写回的 run 状态不丢失", () => {
  it("挂载即显示生成中，收到终态推流事件后确认读到终态、指示消失、真实写回的回复被拉回来渲染", async () => {
    let resolveCount = 0;
    getAgentRun.mockImplementation(async (runId: string) => {
      resolveCount += 1;
      expect(runId).toBe("run-1");
      if (resolveCount < 2) {
        // I-3：事件是 fire-and-forget，可能先于落库事务提交到达——确认读允许对
        // "仍读到非终态"做几次很短的重试（见 `copilotkit-v2-run-restore.ts` 文件头）。
        return { runId: "run-1", threadId: THREAD_ID, status: "running", error: null, resultMessageId: null };
      }
      writtenBack = true;
      return { runId: "run-1", threadId: THREAD_ID, status: "succeeded", error: null, resultMessageId: "cm-2" };
    });

    mount();

    // ① 挂载后：切回的人不该看到"像从没提交过"——生成中指示必须出现。
    await screen.findByTestId("copilotkit-v2-running-indicator");
    expect(screen.getByTestId("copilotkit-v2-thinking-phase").textContent).toContain("恢复");

    // ② 网关推来这个 run 的终态事件——不是轮询发现的，是真实订阅收到的。
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0]!.emit(statusChange("succeeded"));

    // ③ 确认读到终态：指示消失，服务端这期间真实写回的回复出现在消息区。
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    }, { timeout: 5000 });
    await screen.findByText("PDF 已生成，请查收。");
    expect(getAgentRun).toHaveBeenCalledWith("run-1", "b");
    // ④ 拉回来的这条消息身份可解析：`messageId` 是真实 `chat_messages.id`，不是 undefined。
    await waitFor(() => {
      const call = markdownMessageCalls.find((c) => c.text.includes("PDF 已生成"));
      expect(call?.messageId).toBe("cm-2");
    });
  });

  it("挂载时这个 run 其实早就是终态（用户切回来时后端已经写完了）⇒ 不建立任何订阅，不显示生成中", async () => {
    writtenBack = true;
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: THREAD_ID, status: "succeeded", error: null, resultMessageId: "cm-2",
    });

    mount();

    await screen.findByText("PDF 已生成，请查收。");
    // 一开始就没有回复缺口（挂载时 `listMessages` 已经带上 cm-2），`findPendingRunId`
    // 判定这条人类消息已有回复——不该触发任何订阅或确认读。
    // PersistedAgentFeedback 另有一次带 AbortSignal 的归属读取；恢复确认读
    // 使用 (runId, bearer) 两参数，不能把两条路径混为「所有 GET 必须为零」。
    await waitFor(() => expect(getAgentRun).toHaveBeenCalledTimes(1));
    expect(getAgentRun).toHaveBeenCalledWith("run-1", "b", expect.any(AbortSignal));
    expect(getAgentRun).not.toHaveBeenCalledWith("run-1", "b");
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("PDF 已生成，请查收。")).toHaveLength(1);
    expect(sockets.length).toBe(0);
    expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
  });

  /**
   * 2026-08-30（devapp 真实用户复现）—— 第一版 `onSettled` 是零参数回调，run 真的以
   * `failed` 收场时唯一动作是清空 `pendingRunId`：指示消失，用户看到的是自己那句话
   * 安静地没有任何回应，连错误提示都没有。这里钉住修复：`view.status === "failed"`
   * 时必须把服务端错误码经既有 `describeCopilotkitV2RunError` 译文显示在错误横幅里
   * （与 `send()` 失败路径同一个 `copilotkit-v2-error` 锚点），不是静默消失。
   */
  it("收到终态推流事件但 run 其实是 failed ⇒ 显示错误横幅，不是安静地什么都不发生", async () => {
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: THREAD_ID, status: "failed",
      error: "MODEL_CALL_FAILED", resultMessageId: null,
    });

    mount();
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0]!.emit(statusChange("failed"));

    const banner = await screen.findByTestId("copilotkit-v2-error");
    expect(banner.textContent).toContain("模型这次没能返回可用结果");
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    });
  });

  /**
   * 2026-08-30 —— `gave-up`（`useCopilotKitV2RunRestore` 自己确认不了，不是读到了
   * 终态）同一类此前静默消失的问题：401（bearer 过期）不该冒充"已确认失败"，但也不能
   * 什么都不说。Phase 14 F04 之后触发方式变了（终态事件到达后的确认读失败），
   * 断言的用户可见结果不变。
   */
  it("终态事件到达后确认读因 401 放弃（bearer 过期）⇒ 如实提示未能核实，不冒充成功也不冒充失败", async () => {
    getAgentRun.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", undefined));

    mount();
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0]!.emit(statusChange("succeeded"));

    const banner = await screen.findByTestId("copilotkit-v2-error");
    expect(banner.textContent).toContain("登录状态可能已过期");
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    });
  });
});
