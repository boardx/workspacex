/** Regression for #6046: force journal-first terminal recovery through the real chat panel. */
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
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, listThreadAttachments, getAgentRun, createPersonalThread, listCapabilities, tail } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listThreadAttachments: vi.fn(),
  tail: { onSettled: null as null | ((runId: string) => Promise<boolean>) },
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-attach", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, listThreadAttachments, createPersonalThread,
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

vi.mock("@/lib/chat-workbench/use-run-trace-tail", () => ({
  useRunTraceTail: (options: {onSettled: (runId: string) => Promise<boolean>}) => { tail.onSettled = options.onSettled; },
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

it("restores one output card when journal recovery inserts the final message before run recovery", async () => {
  let completed = false;
  getAgentRun.mockImplementation(async () => ({runId: "run-1", threadId: THREAD_ID,
    status: completed ? "succeeded" : "running", error: null, resultMessageId: completed ? "cm-2" : null}));
  listThreadAttachments.mockImplementation(async () => ({items: writtenBack ? [{
    id: "pdf-attachment", filename: "generated.pdf", mime: "application/pdf", bytes: 598,
    createdAt: "2026-08-30T00:00:00.000Z", messageId: "cm-2", extractionStatus: "pending", extractionError: null,
  }] : []}));
  mount();
  await screen.findByTestId("copilotkit-v2-running-indicator");
  await waitFor(() => expect(sockets.length).toBe(1));
  writtenBack = true;
  await act(async () => { expect(await tail.onSettled!("run-1")).toBe(true); });
  await screen.findByText("PDF 已生成，请查收。");
  completed = true;
  await act(async () => { sockets[0]!.emit(statusChange("succeeded")); });
  await waitFor(() => expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByTestId("chat-produced-file-inline-card")).toHaveLength(1));
  expect(screen.getByTestId("chat-produced-file-inline-card")).toHaveTextContent("generated.pdf");
  await act(async () => { expect(await tail.onSettled!("run-1")).toBe(true); });
  expect(screen.getAllByText("PDF 已生成，请查收。")).toHaveLength(1);
  expect(screen.getAllByTestId("chat-produced-file-inline-card")).toHaveLength(1);
});
