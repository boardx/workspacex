/**
 * VZ-01 → live panel（coord ①+续刀）：活体 AI 消息**在可达面**经 MarkdownMessage 渲染
 * （markdown + ```mermaid 白名单闸门），而不再是 CopilotKit 的纯 markdown。这条钉住「接线」
 * 本身——防日后有人把 live panel 的渲染换回纯文本/纯 markdown，只有 MarkdownMessage 自己的
 * 单测还绿。mermaid 引擎在 jsdom mock 掉（这里验接线，不验 SVG 产出）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", presence: "present" as const }];

function msg(over: Record<string, unknown>) {
  return {
    id: "x", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("ChatLiveMessagePanel — AI 消息经 MarkdownMessage 渲染（VZ-01 live 接线）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMessage.mockResolvedValue({ message: msg({ id: "m-h" }), agentRunId: "r", runStatus: "queued" });
  });

  it("agent 消息 → 走 MarkdownMessage：markdown 结构 + 越界 mermaid 落诚实错误态", async () => {
    listMessages.mockResolvedValue({
      messages: [
        msg({ id: "m-ai", authorKind: "agent", agentId: "agent-real",
          text: "## 结论\n\n**要点**：\n\n```mermaid\nxychart-beta\n  line [1,2]\n```" }),
      ],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    // 接线证据：AI 正文进了 MarkdownMessage 的容器 + 越界图落诚实错误态（回显类型）。
    const md = await screen.findByTestId("chat-ai-markdown");
    expect(md.querySelector("h2")?.textContent).toContain("结论");
    const err = await screen.findByTestId("chat-ai-mermaid-error");
    expect(err.textContent).toContain("xychart-beta");
  });

  it("human 消息 → 仍是纯文本，不经 markdown 渲染（不给用户输入 markdown 语义）", async () => {
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-h2", authorKind: "human", text: "**这不该被加粗**" })],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    // 人的消息原样带星号出现，且不产生 markdown 容器。
    expect(await screen.findByText("**这不该被加粗**")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-ai-markdown")).toBeNull();
  });
});
