/**
 * issue #2233（D5 回归钉子）——`#1705`（D-1 agent 角色字段）在 PR #1764 里同时实现了
 * D2（线程头部编制区，`chat-roster-panel.tsx:192` 渲 `{name} · {roleLabel}`）和 D5
 * （消息气泡角色 chip）。`chat-live-message-panel.tsx` 后续被重写约 18 次，D5 那次
 * 曾在某个中间态里跟丢——本文件此前完全没有单测钉住这条渲染，回归发生时任何测试
 * 都不会红。这里补上：agent 消息气泡的身份行必须带一个显示 `roleLabel` 的 chip，
 * 编制里查不到该 agent（或它没有 roleLabel）时不编一个出来。
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

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import type { GetAgentPanelOut } from "@/lib/live-chat";

function msg(over: Record<string, unknown>) {
  return {
    id: "x", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

describe("ChatLiveMessagePanel — D5 消息气泡角色 chip（issue #2233）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMessage.mockResolvedValue({ message: msg({ id: "m-h" }), agentRunId: "r", runStatus: "queued" });
  });

  it("agent 消息气泡的身份行渲染 roleLabel chip，与 D2 编制区同一个字段", async () => {
    const agents = [
      { id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "战略分析师", presence: "present" as const },
    ];
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-ai", authorKind: "agent", agentId: "agent-real", text: "结论已给出" })],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const row = await screen.findByTestId("chat-message-row");
    expect(row.textContent).toContain("真实 Agent");
    expect(row.textContent).toContain("战略分析师");
  });

  it("agent 已被移出编制（agents 里查不到）时不编一个 chip 出来", async () => {
    // `roleLabel` 契约上非空（I-17，见 chat.ts:657 头注），真实数据不会是空字符串——
    // 「查不到 roleLabel」在产品里唯一会发生的场景是这条消息的 agent 已经不在当前
    // 编制里了（`agents` 数组里没有它），`agentLabel`/`agentRoleLabel` 都回落到
    // 「查不到就不编」，不是给一个空字符串。
    const agents: GetAgentPanelOut["agents"] = [];
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-ai2", authorKind: "agent", agentId: "agent-removed", text: "结论已给出" })],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);

    const row = await screen.findByTestId("chat-message-row");
    // 查不到就回落到裸 id，不糊成「Agent」（`agentLabel` 的文档注释）。
    await waitFor(() => expect(row.textContent).toContain("agent-removed"));
    // 编制里没有这个 agent，不编一个 roleLabel chip 出来。
    // `Badge tone="ai"` 是唯一渲染 `bg-ai-tint` 的地方（`badge.tsx`），用它当探针。
    expect(row.querySelector(".bg-ai-tint")).toBeNull();
  });
});
