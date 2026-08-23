/**
 * issue #1819（十项 UX 缺口第 7 项，P0，人类 2026-08-22 devapp 实测）——
 * 长会话后 `GET /agent-runs/:runId` 返回 401（session/token 过期），此前前端：
 *   ① 轮询不停：继续按退避排下一次调用，直到 20 分钟预算耗尽，对着一个
 *      必然继续 401 的端点白打请求。
 *   ② 「正在思考…」占位（`chat-message-row-thinking`）永久卡住：`awaitingReply`
 *      只看 `runObservation.view` 是否到终态，401 时 `view` 永远是 null，
 *      占位动画与下方已经生成好的"登录已失效"文案同屏矛盾地并存。
 *
 * 本用例覆盖修复后的行为：401 → 立即停止轮询（不再有下一次 `getAgentRun`
 * 调用）+ 「正在思考…」让位 + 清晰的登录过期提示可见。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

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

async function flushMicrotasks(times = 12) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("ChatLiveMessagePanel — AgentRun 轮询遇 401（issue #1819）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 与既有 longrun-hint 用例同一套接线：初次空列表，发送后的软重读要读到
    // 刚发的那条人类消息，「正在思考」占位才会渲染（`messages.length > 0`）。
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

  it("①401 → 立即停止轮询：不再有下一次 getAgentRun 调用（不是最终会停，是收到 401 那次就不再排下一次）", async () => {
    getAgentRun.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", undefined));
    await submit();

    // 首次轮询（`RUN_POLL_FIRST_DELAY_MS` 之后）触发这次 401。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const callsAfterFirst401 = getAgentRun.mock.calls.length;
    expect(callsAfterFirst401).toBeGreaterThan(0);

    // 就算再往前推很久（远超单次退避间隔、也远小于 20 分钟预算），也不应该再打第二次——
    // 401 已经让这个 run 的轮询提前终止，不受 deadline 支配继续重试。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getAgentRun.mock.calls.length).toBe(callsAfterFirst401);
  });

  it("②「正在思考…」让位，展示登录已过期提示，且状态条标出 authExpired", async () => {
    getAgentRun.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", undefined));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // 占位动画不再渲染——不能既说"正在思考"又说"登录已过期"。
    expect(screen.queryByTestId("chat-message-row-thinking")).not.toBeInTheDocument();

    const status = screen.getByTestId("chat-live-agent-run-status");
    expect(status).toHaveAttribute("data-run-auth-expired", "true");
    expect(status.textContent).toContain("登录已失效");
    expect(status.textContent).toContain("请重新登录");
  });

  it("③非 401 失败（如 503）不受影响：仍然继续轮询、不提前终止", async () => {
    getAgentRun.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", undefined));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const callsAfterFirst = getAgentRun.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // 非 401 的失败应该继续按退避重试——调用次数应当继续增长。
    expect(getAgentRun.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    const status = screen.getByTestId("chat-live-agent-run-status");
    expect(status).not.toHaveAttribute("data-run-auth-expired");
  });
});
