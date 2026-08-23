/**
 * issue #1907（用户 devapp 截图报告）—— 个人对话发消息给通用助手后，回复区域
 * 同时出现两个进度块：一个「正在执行…」，一个「正在思考…已用 9 秒」。
 *
 * 根因：同一个 in-flight run 被两条独立渲染路径同时展示成两个 `<li>`：
 * - `chat-run-process-area`（挂 AgentPlanPanel/AgentApprovalPanel/AgentToolChain）
 *   在 `runObservation.view` 非 null 且未被终态消息接管时渲染；steps 为空、
 *   非 awaiting_approval、非 failed 时，AgentPlanPanel/AgentApprovalPanel 都
 *   返回 null，唯一内容是 AgentToolChain 在 running=true 时给出的摘要
 *   「…正在执行…」（`agent-tool-chain.tsx` 的 `toolChainSummaryText`）。
 * - `chat-message-row-thinking`（`awaitingReply`）同时为 true，显示
 *   「正在思考…已用 N 秒」。
 *
 * 两者在这种「没有工具调用、run 还没到终态」的窗口里同时渲染，读起来像两个
 * 独立的助手响应。本用例锁定修复后的行为：没有实质过程内容（无 plan、无
 * 待批准、无 tool step、非失败终态）时，`chat-run-process-area` 不单独渲染，
 * 只保留 `chat-message-row-thinking` 一个进度块；一旦有 step/待批准/失败，
 * `chat-run-process-area` 照常渲染（不丢失有效信息）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { listMessages, createMessage, getAgentRun, openAgentRunStream, openAsrDraftStream } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
  openAsrDraftStream: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
  createMessage,
  landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream,
}));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

const agents = [
  { id: "agent-a", abbr: "AA", name: "Agent A", duty: "研究", roleLabel: "研究", presence: "present" as const },
];

/** 字段形状照 `wave2-runtime.ts` 的 `AgentRunView`。 */
function agentRunView(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: "run-1",
    threadId: "t",
    inputMessageId: "m-1",
    agentId: "agent-a",
    agentVersionId: "agent-a-v1",
    skillVersionIds: [],
    modelProvider: "test-provider",
    modelId: "test-model",
    status: "running",
    error: null,
    resultMessageId: null,
    steps: [],
    pendingApproval: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function step(kind: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind,
    status: "succeeded",
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    inputDigest: null,
    outputDigest: null,
    failureCode: null,
    toolName: null,
    toolArgsSummary: null,
    toolResultSummary: null,
    planningNote: null,
    ...overrides,
  };
}

async function flushMicrotasks(times = 12) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("ChatLiveMessagePanel — 不重复渲染同一个 run 的进度块（issue #1907）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessages
      .mockResolvedValueOnce({ messages: [], nextCursor: null })
      .mockResolvedValue({
        messages: [{
          id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "你好",
          clientMessageId: null, agentRunId: "run-1", replyToMessageId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        }],
        nextCursor: null,
      });
    createMessage.mockResolvedValue({
      message: {
        id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "x",
        clientMessageId: null, agentRunId: null, replyToMessageId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      agentRunId: "run-1",
      runStatus: "queued",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function submit() {
    vi.useFakeTimers();
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false}
      />,
    );
    await flushMicrotasks();

    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTestId("chat-message-submit"));
    await flushMicrotasks();
  }

  it("没有真实 step / 未到终态时只出现一个进度块（正在思考…），不额外渲染空过程区", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "running", steps: [] }));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-message-row-thinking")).toBeInTheDocument();
    // 修复前：steps 为空时 `chat-run-process-area` 仍会渲染一个只有头像+名字、
    // 没有任何过程内容的空行——紧挨着「正在思考…」，读起来像多出了一个空的
    // 助手响应块。
    expect(screen.queryByTestId("chat-run-process-area")).not.toBeInTheDocument();
  });

  it("只有 accepted 之类的非工具 step 时（run 已接受但还没调用工具），不与「正在思考」重复", async () => {
    // 这是用户截图报的真实场景：服务端已经记了 `accepted` step（steps.length > 0，
    // `AgentToolChain` 因此不会因 `steps.length === 0` 直接返回 null），但还没有任何
    // `tool_call` step——`toolChainSummaryText` 在 running=true 时给出的摘要正是
    // 「…正在执行…」，与同时渲染的「正在思考…已用 N 秒」文案重复，两块并存。
    getAgentRun.mockResolvedValue(agentRunView({ status: "running", steps: [step("accepted")] }));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-message-row-thinking")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-run-process-area")).not.toBeInTheDocument();
  });

  it("有真实 step 时过程区照常渲染（不丢失有效信息），与思考卡片共存", async () => {
    getAgentRun.mockResolvedValue(agentRunView({
      status: "running",
      steps: [step("tool_call", { toolName: "list_org_skills" })],
    }));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-run-process-area")).toBeInTheDocument();
  });

  it("awaiting_approval 时过程区渲染（承载审批卡片）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({
      status: "awaiting_approval",
      steps: [step("tool_call", { toolName: "call_skill" })],
      pendingApproval: { toolName: "call_skill", argsSummary: "{}" },
    }));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-run-process-area")).toBeInTheDocument();
  });

  it("failed 时过程区渲染（承载失败详情 + 重试入口）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "failed", steps: [], error: "MODEL_CALL_FAILED" }));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-run-process-area")).toBeInTheDocument();
    expect(screen.getByTestId("chat-run-process-failure")).toBeInTheDocument();
  });
});
