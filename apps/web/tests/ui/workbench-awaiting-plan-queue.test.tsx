/** Real panel/composer and running-reply hook; restored state and queue boundary are controlled. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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


const queue = vi.hoisted(() => ({enqueue:vi.fn().mockResolvedValue(true)}));
vi.mock("@/lib/chat-workbench/use-thread-message-queue", () => ({useThreadMessageQueue:()=>({items:[],enqueue:queue.enqueue,cancel:vi.fn(),cancelling:null,error:null})}));
vi.mock("@/lib/copilotkit-v2-run-restore", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/copilotkit-v2-run-restore")>(),
  useCopilotKitV2RunRestore:()=>({runId:"run-1",status:"awaiting_plan_confirmation",isRestoring:false,reconnectState:"connected",cancel:vi.fn(),error:null}),
}));

it("restored plan confirmation without active journal trace routes composer input to the next-turn queue", async () => {
  getAgentRun.mockResolvedValue({runId:"run-1",threadId:THREAD_ID,status:"awaiting_plan_confirmation",resultMessageId:null,pendingApproval:null});
  const requests = vi.spyOn(globalThis,"fetch");
  mount();
  const input = await screen.findByTestId("copilotkit-v2-input");
  await waitFor(()=>expect(listMessages).toHaveBeenCalled());
  // No journal events are emitted and the freshly mounted AG-UI agent is idle.
  fireEvent.change(input,{target:{value:"下一轮补充 B"}});
  const send = screen.getByTestId("copilotkit-v2-send");
  await waitFor(()=>expect(send).not.toBeDisabled());
  fireEvent.click(send);
  await waitFor(()=>expect(queue.enqueue).toHaveBeenCalledWith("下一轮补充 B",expect.objectContaining({clientMessageId:expect.any(String)})));
  expect(queue.enqueue).toHaveBeenCalledTimes(1);
  expect(createPersonalThread).not.toHaveBeenCalled();
  expect(requests.mock.calls.some(([url, options]) => options?.method === "POST" && /\/agent\/[^/]+\/run|\/copilotkit\/agui/.test(String(url)))).toBe(false);
  expect(screen.queryByTestId("copilotkit-v2-error")).toBeNull();
});
