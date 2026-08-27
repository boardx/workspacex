/**
 * issue #2277（D8 前半）—— composer 顶部上下文行：参与 agent 头像串 + skill +
 * 已引用上下文 + 更多设置（禁用+说明）。只测**有真实数据支撑**的三项渲染逻辑，
 * 不测「输出落点」「改派建议」——那两项本仓没有数据源，未实现（见 #2278）。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { listMessages, createMessage, uploadAttachment, getAgentRun, openAgentRunStream } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  uploadAttachment: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createMessage, uploadAttachment, landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()), getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

const agents = [
  { id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "研究", presence: "present" as const },
];

function pdf(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

describe("ChatLiveMessagePanel — D8 composer 上下文行（issue #2277）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    createMessage.mockResolvedValue({
      message: { id: "m", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      agentRunId: "r", runStatus: "queued",
    });
  });

  it("有编制 agent 时渲染参与 agent 头像串", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-agents")).toBeInTheDocument();
  });

  it("零编制 agent 时不渲染头像串（不编一个出来）", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={[]} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer-context-agents")).toBeNull();
  });

  it("hasMountedSkills=true 时渲染 skill 指示（不编具体名字）", async () => {
    render(
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} hasMountedSkills />,
    );
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-skill")).toHaveTextContent("已挂载 skill");
  });

  it("hasMountedSkills=false（缺省）时不渲染 skill 指示", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer-context-skill")).toBeNull();
  });

  it("draft 挂着真实附件时渲染「已引用 N 项上下文」，数字随上传变化", async () => {
    uploadAttachment.mockResolvedValue({ id: "att-1", filename: "a.pdf", bytes: 1024, mime: "application/pdf" });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer-context-attachments")).toBeNull();

    const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("a.pdf")] } });
    await waitFor(() => expect(screen.getByTestId("chat-composer-context-attachments")).toHaveTextContent("已引用 1 项上下文"));
  });

  it("更多设置按钮存在但禁用（暂无可配置项，不放一个点了没反应的按钮）", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-more")).toBeDisabled();
  });

  it("线程已归档时不渲染上下文行（composer 本身已只读）", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer-context-line")).toBeNull();
  });
});
