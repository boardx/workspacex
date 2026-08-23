/**
 * gap #8（十项 UX 缺口第 8 项，P1，人类 2026-08-22 devapp 实测，未修复）——
 * 长任务只有笼统「正在思考…已用 N 秒」，没有分阶段进度：pptx 这类脚本执行
 * 任务真实耗时能到 15-20 分钟，中间经历多个阶段（模型调用/技能准备/脚本
 * 执行）但界面全程只有一个计时器，猜不出卡在哪一步。
 *
 * 本用例覆盖修复后的行为：`GET /agent-runs/:runId` 轮询到的 `steps` 数组
 * 逐步演进时，「正在思考…」卡片旁边的阶段文案（`chat-thinking-phase`）跟着
 * 变化——不是只显示计时器；未识别的 step kind 兜底显示通用文案，不报错、
 * 不留空。
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

/** 字段形状照 `wave2-runtime.ts` 的 `AgentRunView`（与 chat-read-screen.test.tsx 同一套）。 */
function agentRunView(steps: readonly Record<string, unknown>[]) {
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
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
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

describe("ChatLiveMessagePanel — 正在思考卡片的阶段文案（gap #8）", () => {
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

  it("没有 step 时不显示阶段文案（保留原来纯计时器的措辞）", async () => {
    getAgentRun.mockResolvedValue(agentRunView([]));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-message-row-thinking")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-thinking-phase")).not.toBeInTheDocument();
  });

  it("steps 逐步演进时，阶段文案跟着最新一条 step 变化", async () => {
    getAgentRun.mockResolvedValue(agentRunView([step("accepted")]));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("正在准备");

    getAgentRun.mockResolvedValue(agentRunView([step("accepted"), step("context_built")]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("上下文");

    getAgentRun.mockResolvedValue(agentRunView([
      step("accepted"), step("context_built"), step("model_called"),
    ]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("模型正在思考");

    getAgentRun.mockResolvedValue(agentRunView([
      step("accepted"), step("context_built"), step("model_called"),
      step("tool_call", { toolName: "list_org_skills" }),
    ]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("准备技能");

    getAgentRun.mockResolvedValue(agentRunView([
      step("accepted"), step("context_built"), step("model_called"),
      step("tool_call", { toolName: "list_org_skills" }),
      step("tool_call", { toolName: "call_skill" }),
    ]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("执行技能脚本");
  });

  it("未识别的 step kind 兜底显示通用文案，不报错、不留空", async () => {
    getAgentRun.mockResolvedValue(agentRunView([step("some_future_kind_nobody_has_seen")]));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("正在处理");
  });

  it("未识别的 tool_call toolName 也兜底显示通用工具文案", async () => {
    getAgentRun.mockResolvedValue(agentRunView([
      step("tool_call", { toolName: "some_unmapped_tool" }),
    ]));
    await submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(screen.getByTestId("chat-thinking-phase").textContent).toContain("正在调用工具");
  });
});
