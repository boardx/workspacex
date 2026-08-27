/**
 * issue #2285（D10 前半，rev-uiux 复评）—— 进行中态落点从 composer 下方挪到输入区
 * 上方的行内卡，并补进度计数。
 *
 * 数据源调查结论（同 #2280/#2282 的分工，本次只补前端展示）：
 * - 落点：`chat-live-agent-run-status` 此前渲在 `data-testid="chat-composer"` 内部
 *   （在 `<Textarea>` 之后），DOM 上必然排在输入框**下方**。这里只钉住
 *   一件事——它现在必须出现在 `chat-composer` 节点**之前**（`compareDocumentPosition`
 *   的 `DOCUMENT_POSITION_PRECEDING`），不依赖像素坐标。
 * - 进度计数：`write_todos` 落的 `agent_run_steps` 已经是消息流里「计划 N/M」
 *   （`agent-plan-panel.tsx` 的 `derivePlanTodos`）的同一份数据源，这里只是让
 *   进行中卡片也读同一份、不新起第二份计数逻辑。
 * - 暂停：仍不实现（#2281 未解决，无真实取消/暂停端点）——沿用 #2280 已有的
 *   「不渲染任何声称暂停的控件」机械钉子，本文件不重复起第二份同款用例。
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
  listMessages, createMessage, landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()), getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()), openAsrDraftStream,
}));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

const agents = [
  { id: "agent-a", abbr: "AA", name: "Agent A", duty: "研究", roleLabel: "研究", presence: "present" as const },
];

function writeTodosStep(todos: { content: string; status: string }[]) {
  return {
    kind: "tool_call" as const, status: "succeeded" as const,
    startedAt: "2026-08-22T00:00:00Z", endedAt: "2026-08-22T00:00:01Z",
    toolName: "write_todos", toolArgsSummary: JSON.stringify({ todos }), toolResultSummary: null,
    planningNote: null, failureCode: null, inputDigest: null, outputDigest: null,
  };
}

function agentRunView(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: "run-1", threadId: "t", inputMessageId: "m-1", agentId: "agent-a", agentVersionId: "agent-a-v1",
    skillVersionIds: [], modelProvider: "test-provider", modelId: "test-model",
    status: "running", error: null, resultMessageId: null, steps: [], pendingApproval: null,
    createdAt: "2026-01-01T00:00:00.000Z",
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

describe("ChatLiveMessagePanel — D10 进行中态行内卡落点 + 进度计数（issue #2285）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
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
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />,
    );
    await flushMicrotasks();
    const input = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTestId("chat-message-submit"));
    await flushMicrotasks();
  }

  it("进行中卡片渲染在 composer 节点之前——落点是输入区上方，不是下方", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "running" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();

    const statusCard = screen.getByTestId("chat-live-agent-run-status");
    const composer = screen.getByTestId("chat-composer");
    // eslint-disable-next-line no-bitwise
    expect(statusCard.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("有 write_todos 计划时，进行中卡片显示「已完成/总数」进度计数（复用消息流同一份数据）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({
      status: "running",
      steps: [writeTodosStep([
        { content: "理解用户问题", status: "completed" },
        { content: "查询当前时间", status: "in_progress" },
        { content: "组织最终回答", status: "pending" },
      ])],
    }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();

    const progress = screen.getByTestId("chat-live-agent-run-plan-progress");
    expect(progress).toHaveAttribute("data-plan-done", "1");
    expect(progress).toHaveAttribute("data-plan-total", "3");
    expect(progress.textContent).toContain("1/3");
  });

  it("没有 write_todos 计划时不显示进度计数（不编一个假的 0/0）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "running", steps: [] }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();

    expect(screen.queryByTestId("chat-live-agent-run-plan-progress")).toBeNull();
  });

  it("终态（succeeded）之后进度卡片本身不再渲染「查看进度」，但状态条仍在——不因为挪了位置就丢了既有终态行为", async () => {
    getAgentRun.mockResolvedValue(agentRunView({
      status: "succeeded", resultMessageId: "m-2",
      steps: [writeTodosStep([{ content: "唯一步骤", status: "completed" }])],
    }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();

    expect(screen.queryByTestId("chat-live-agent-run-view-progress")).toBeNull();
    expect(screen.getByTestId("chat-live-agent-run-status")).toBeInTheDocument();
  });
});
