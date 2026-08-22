/**
 * 2026-08-16 人类实测反馈：AI 消息的动作条（复制/反馈👎/评分👍👎）此前画在身份行
 * （名字/角色/时间那一排，气泡**上方**），对标 Claude Code 挪到气泡（含附件）**下方**——
 * 回复读完才看到动作按钮，不与身份信息抢视觉重量。这个文件钉住"挪对了地方"这件事本身
 * （DOM 顺序：正文气泡先出现，动作条紧随其后），不是重复测这些按钮各自的点击行为
 * （复制见既有测试，反馈见 feedback-dialog.test.tsx，评分见 chat-message-rating.test.tsx）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

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
import { FeedbackProvider } from "@/components/feedback/feedback-provider";

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "研究", presence: "present" as const }];

function msg(over: Record<string, unknown>) {
  return {
    id: "x", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("ChatLiveMessagePanel — 动作条位置（气泡下方，非身份行）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentRun.mockResolvedValue(null);
  });

  it("复制/反馈/评分按钮出现在正文气泡之后（DOM 序），不在身份行（名字/时间那一排）里", async () => {
    listMessages.mockResolvedValue({
      messages: [
        msg({
          id: "m-ai", authorKind: "agent", agentId: "agent-real", agentRunId: "run-1",
          text: "这是一条会被真的读完的回复正文。",
        }),
      ],
      nextCursor: null,
    });
    render(
      <FeedbackProvider>
        <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />
      </FeedbackProvider>,
    );

    const row = await screen.findByTestId("chat-message-row");
    const bodyNode = await within(row).findByText("这是一条会被真的读完的回复正文。");
    const copyButton = within(row).getByTestId("chat-message-copy");

    // Node.compareDocumentPosition 的 FOLLOWING 位掩码是 4：copyButton 在 bodyNode 之后才算通过。
    // eslint-disable-next-line no-bitwise
    const bodyPrecedesCopy = (bodyNode.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(bodyPrecedesCopy).toBe(true);

    // 反向钉住：身份行（含名字「真实 Agent」文本节点）不应该再包住复制按钮——
    // 挪位前两者同处一个 flex 行容器，挪位后必须是两个不同的兄弟块。
    const nameNode = within(row).getByText("真实 Agent");
    const identityRow = nameNode.closest("div");
    expect(identityRow?.contains(copyButton)).toBe(false);

    // 👎（对 agent 本身的反馈）也在动作条里，同样跟着挪到气泡下方。
    const feedbackButton = within(row).getByTestId("chat-agent-feedback");
    // eslint-disable-next-line no-bitwise
    const bodyPrecedesFeedback = (bodyNode.compareDocumentPosition(feedbackButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(bodyPrecedesFeedback).toBe(true);
    expect(identityRow?.contains(feedbackButton)).toBe(false);
  });

  it("人类自己发的消息：复制按钮仍在（V3 原有行为，挪位不取消），但没有反馈/评分（没有 agent 可归因）", async () => {
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-human", authorKind: "human", text: "我自己说的话" })],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const row = await screen.findByTestId("chat-message-row");
    expect(within(row).getByTestId("chat-message-copy")).toBeTruthy();
    expect(within(row).queryByTestId("chat-agent-feedback")).toBeNull();
  });
});
