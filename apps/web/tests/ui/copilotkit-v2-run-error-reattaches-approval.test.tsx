/**
 * issue #3367 第 ③ 类 —— 「run 其实还在等人批，界面却说它出错了」。
 *
 * ## 缺陷形状（不是假设，是 `decide-tool-permission.ts` 自己的前置条件）
 *
 * `decideToolPermission` 的 `stale_permission_request` / `form_decision_required` 两支
 * （L67-79）都在**已经确认 `status === "awaiting_tool_permission"` 之后**才抛
 * `RunNotAwaitingToolPermissionError` ⇒ SSE 桥写出
 * `RUN_ERROR{code:"AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION"}` 时，那条 run **一动没动**，
 * 它仍持有一条有效的待批请求。
 *
 * 而审批卡此前只有两个挂载来源：本次订阅上的 `awaiting_tool_permission` **推流事件**，
 * 或切回/刷新那次**恢复读**。被拒的这一次两者都不占（run 状态没变，不会再来一条状态
 * 事件；恢复路径这一轮也不会重跑）⇒ 卡片永不重挂，用户只剩一句
 * 「最近一次调用出错，正在等待执行状态更新……」，再也回不到那个能授权的地方。
 *
 * ## 判据落在哪
 *
 * 参照 #3311 的先例：判据必须是**用户真的到达了可以授权的地方**，不是「事件里多了个
 * 字段」也不是「文案变了」——那两种断言在本缺陷下判别力为零（字段/文案都可以对，卡片
 * 依然不出现）。所以下面断言的是：四个决策按钮**可见且可点**，点下去**真的发出了那次
 * 授权请求**（`decidePermissionRequest`）。
 *
 * ⚠ 本文件刻意让线程里**没有**未回复的历史消息 ⇒ `useCopilotKitV2RunRestore` 根本不启动
 *   （同 `copilotkit-v2-live-failure-cause-banner.test.ts` 的自检纪律）。恢复路径若同时在
 *   跑，它那次权威读会自己把卡片挂上，测试就会假绿——反证时正是靠这一条才能变红。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-reattach", version: 1 })),
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

import * as React from "react";
import { CopilotKit, useCopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-reattach";
const RUN_ID = "run-reattach-1";
const PERMISSION_REQUEST_ID = "11111111-2222-4333-8444-555555555555";

const fetchCalls: string[] = [];

class SilentWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1;
  static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 1;
  constructor(readonly url: string, readonly protocols?: string[]) { super(); }
  send(): void {}
  close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

type ErrorBus = {
  emitError(params: { error: Error; code: string; context?: Record<string, unknown> }): Promise<void>;
};
type AgentLike = {
  subscribers: Array<{ onCustomEvent?: (params: { event: unknown }) => void }>;
  setMessages?: (messages: unknown[]) => void;
  messages?: unknown[];
};
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

/** 与 `copilotkit-agui.controller.ts` 接受 run 后写上 wire 的那条 durable execution 事件同形。 */
function emitRunStatus(runId: string, status: string, seq: number): void {
  const event = {
    name: "execution_event",
    value: { runId, seq, kind: "status", status, emittedAt: "2026-09-10T00:00:00.000Z" },
  };
  for (const agent of Object.values(agents)) {
    for (const subscriber of agent.subscribers ?? []) subscriber.onCustomEvent?.({ event });
  }
}

/** 服务端的权威事实：这条 run 仍停在待批态，那条待批请求依然有效。 */
const STILL_AWAITING = {
  runId: RUN_ID, threadId: THREAD_ID, status: "awaiting_tool_permission",
  error: null, failureReason: null, resultMessageId: null,
  pendingApproval: {
    permissionRequestId: PERMISSION_REQUEST_ID,
    interrupt: null,
    toolName: "call_skill",
    argsSummary: '{"skill_stable_name":"web-research","task":"查最新行业数据"}',
  },
} as const;

function msg(id: string, authorKind: "human" | "agent", text: string, agentRunId: string | null) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId, replyToMessageId: null, createdAt: "2026-09-10T00:00:00.000Z",
  };
}

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CoreProbe />
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

async function reachRunErrorForStaleDecision(code: string): Promise<void> {
  mount();
  await waitFor(() => expect(errorBus).not.toBeNull());
  await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
  /*
   * 等历史回读把那条消息灌进 agent——空态（`agent.messages.length === 0`）分支根本不渲染
   * 消息子树，审批卡挂在其中。这一步同时是 hydration 完成的信号。
   */
  await waitFor(() => expect(screen.queryByTestId("chat-task-workbench-template-research")).toBeNull());
  // ① 这一轮 run 被接受（推流上最后一条状态是 running——没有任何
  //    `awaiting_tool_permission` 推流事件会再来，中断发生在这次订阅看不到的地方）。
  await act(async () => { emitRunStatus(RUN_ID, "running", 0); });
  // ② 用户的裁决被服务端以「当前不处于等待审批状态」拒掉 —— 而 run 一动没动。
  await errorBus!.emitError({
    error: new Error(code),
    code: "agent_run_error_event",
    context: { source: "onRunErrorEvent", runtimeErrorCode: code },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  errorBus = null;
  agents = {};
  vi.stubGlobal("WebSocket", SilentWebSocket);
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  /*
   * 线程里有一条**已经有回复的**历史消息：只为让面板离开空态（空态分支根本不渲染
   * 审批卡），`agentRunId` 一律为 null ⇒ `findPendingRunId` 找不到任何"可能还没写回"
   * 的 run ⇒ `useCopilotKitV2RunRestore` **不启动**。这是本文件的自检：恢复路径若在跑，
   * 它自己那次权威读就会把卡片挂上，测试会假绿。
   */
  listMessages.mockResolvedValue({
    messages: [
      msg("cm-1", "human", "帮我查一下最新的行业数据", null),
    ],
    nextCursor: null,
  });
  getAgentRun.mockResolvedValue(STILL_AWAITING);
  /*
   * 授权按钮点下去走的是真实 `apiRequest` → `fetch`。这里在**网络层**接住它：判据因此是
   * 「那次授权请求真的发出去了」，不是「某个 mock 被调用了」。
   * 返回体带上执行轨迹分页读需要的空 `events`（否则 `page.events` 会被 `.filter`）。
   */
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    fetchCalls.push(String(typeof input === "string" ? input : (input as { url?: string }).url ?? input));
    return new Response(JSON.stringify({ events: [], legacyEvents: [], nextSeq: null, items: [], messages: [], nextCursor: null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }));
});

describe("issue #3367 —— RUN_ERROR 说「不在待批态」而 run 其实还在等人批", () => {
  it("用户必须重新看到一张可操作的审批卡，并且真的能授权", async () => {
    await reachRunErrorForStaleDecision("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION");

    // ③ 判据：用户到达了**可以授权的地方**（#3311 先例），不是「字段对了」。
    const card = await screen.findByTestId("tool-permission-card", undefined, { timeout: 5000 });
    expect(card).toBeVisible();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"]) {
      const button = screen.getByTestId(testId);
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
    }

    // ④ 点下去真的把这次授权发出去了——卡片不是一张画着按钮的图片。
    await act(async () => { fireEvent.click(screen.getByTestId("perm-run")); });
    await waitFor(() => {
      const decided = fetchCalls.find((url) => url.includes(PERMISSION_REQUEST_ID));
      expect(
        decided,
        "审批卡上的按钮点下去没有把授权请求发出去——用户看到的是一张点不动的卡片。"
          + `实际发出的请求：${JSON.stringify(fetchCalls)}`,
      ).toBeTruthy();
      expect(String(decided)).toContain(RUN_ID);
    });

    // ⑤ 那句误译的「出错了」横幅不该再挂着：它把一次合法的人类审批说成了失败。
    expect(screen.queryByTestId("copilotkit-v2-error")).toBeNull();
  });

  it("NO_PENDING_APPROVAL 同样重挂：权威读说仍有待批请求就以权威读为准", async () => {
    await reachRunErrorForStaleDecision("NO_PENDING_APPROVAL");
    const card = await screen.findByTestId("tool-permission-card", undefined, { timeout: 5000 });
    expect(card).toBeVisible();
  });

  /**
   * fail closed 的另一半：权威读说这条 run 已经不在待批态时，绝不凭一个错误码造卡片
   * ——那会把「已经被别人批过了」演成「还在等你批」，是同一个病换一个方向。
   */
  it("权威读说已经不在待批态 ⇒ 不弹卡片，照旧显示横幅", async () => {
    getAgentRun.mockResolvedValue({
      runId: RUN_ID, threadId: THREAD_ID, status: "running",
      error: null, failureReason: null, resultMessageId: null, pendingApproval: null,
    });
    await reachRunErrorForStaleDecision("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION");
    const banner = await screen.findByTestId("copilotkit-v2-error");
    await waitFor(() => expect(banner.textContent).toContain("这次执行当前不处于等待审批状态"));
    expect(screen.queryByTestId("tool-permission-card")).toBeNull();
  });
});
