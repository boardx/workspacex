/**
 * issue #2280（D10 前半）—— agent 执行中态的「查看进度」真实操作。调查结论：
 * 「暂停」在本仓没有真实能力可接（无取消/暂停端点），不实现、不伪造（见 #2281）；
 * 「查看进度」复用既有的 `scrollToLatest`（与「回到最新」同一个真实滚动动作），
 * 这里只钉住：非终态渲染按钮、终态不渲染、点击不报错（真的调用了滚动）。
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

describe("ChatLiveMessagePanel — D10「查看进度」（issue #2280）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 不实现 `Element.scrollTo`——真实浏览器有，这里补一个空实现，
    // 不然点击按钮触发 `scrollToLatest()` 会抛 `el.scrollTo is not a function`。
    // 断言的是"真的调用了它"（下面 `scrollToSpy`），不是靠它真的滚动画面。
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

  it("run 进行中（running）时渲染「查看进度」，点击真实触发滚动（复用既有 scrollToLatest）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "running" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();

    const button = screen.getByTestId("chat-live-agent-run-view-progress");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
  });

  it("run 排队中（queued）时同样渲染「查看进度」", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "queued" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-live-agent-run-view-progress")).toBeInTheDocument();
  });

  it("run 到达终态（succeeded）后不再渲染「查看进度」——不是常驻按钮", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "succeeded", resultMessageId: "m-2" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();
    expect(screen.queryByTestId("chat-live-agent-run-view-progress")).toBeNull();
  });

  it("run 失败（failed）后不再渲染「查看进度」", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "failed", error: "MODEL_CALL_FAILED" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();
    expect(screen.queryByTestId("chat-live-agent-run-view-progress")).toBeNull();
  });

  // D10 调查结论的机械钉子：本仓没有暂停/取消 run 的真实端点，不允许出现声称
  // 「暂停」的可点击控件——出现即视为伪造交互的回归。
  it("不渲染任何声称「暂停」的按钮（无真实能力，不伪造）", async () => {
    getAgentRun.mockResolvedValue(agentRunView({ status: "running" }));
    await submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flushMicrotasks();
    expect(screen.queryByText("暂停")).toBeNull();
  });
});
