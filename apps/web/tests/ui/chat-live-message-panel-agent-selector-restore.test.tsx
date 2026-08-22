/**
 * #1806 —— 2026-08-22 devapp 实测反证：用 Deep Research 在某条线程发过消息后，切走
 * 再切回来（或刷新重进），「运行 Agent」选择器显示的是硬编码的「通用助手」，不是这条
 * 线程实际用过的「Deep Research」。这里钉住组件接线：换线程加载完消息后，选择器默认
 * 应恢复成线程历史里最近一条 agent 消息用过的那个 agent，而不是盲选「通用助手」。
 *
 * 纯函数本身（从消息列表挑最近一条 agent 消息的 agentId）的单测见
 * `tests/lib/pick-default-agent-id.test.ts` 的 `lastUsedAgentId` 那组。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn().mockResolvedValue(true), render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }) },
}));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

const agents = [
  { id: "agent-general", abbr: "通用", name: "通用助手", duty: "通用对话", roleLabel: "通用", presence: "present" as const },
  { id: "agent-deep", abbr: "DR", name: "Deep Research", duty: "深度研究", roleLabel: "研究", presence: "present" as const },
];

function msg(over: Record<string, unknown>) {
  return {
    id: "x", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("ChatLiveMessagePanel — 重开线程后「运行 Agent」选择器恢复成线程实际用过的 agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("线程最近一条消息来自 Deep Research → 选择器默认高亮 Deep Research，不是硬编码的通用助手", async () => {
    listMessages.mockResolvedValue({
      messages: [
        msg({ id: "m-1", authorKind: "human", text: "帮我研究一下" }),
        msg({
          id: "m-2", authorKind: "agent", agentId: "agent-deep", text: "研究结果如下",
          createdAt: "2026-08-22T10:00:00.000Z",
        }),
      ],
      nextCursor: null,
    });

    render(<ChatLiveMessagePanel threadId="t-deep" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const trigger = await screen.findByTestId("chat-agent-select");
    expect(trigger.title).toBe("运行 Agent：Deep Research");
    expect(trigger.textContent).toContain("Deep Research");
  });

  it("线程从没有 agent 消息 → 仍然回落到「通用助手」（既有行为，未被本次修法破坏）", async () => {
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-1", authorKind: "human", text: "你好" })],
      nextCursor: null,
    });

    render(<ChatLiveMessagePanel threadId="t-empty" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const trigger = await screen.findByTestId("chat-agent-select");
    expect(trigger.title).toBe("运行 Agent：通用助手");
  });

  it("多条 agent 消息交替出现 → 取 createdAt 最新那条对应的 agent，不是第一条", async () => {
    listMessages.mockResolvedValue({
      messages: [
        msg({ id: "m-1", authorKind: "agent", agentId: "agent-deep", createdAt: "2026-08-20T00:00:00.000Z" }),
        msg({ id: "m-2", authorKind: "human", createdAt: "2026-08-21T00:00:00.000Z" }),
        msg({ id: "m-3", authorKind: "agent", agentId: "agent-general", createdAt: "2026-08-22T00:00:00.000Z" }),
      ],
      nextCursor: null,
    });

    render(<ChatLiveMessagePanel threadId="t-mixed" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const trigger = await screen.findByTestId("chat-agent-select");
    expect(trigger.title).toBe("运行 Agent：通用助手");
  });
});
