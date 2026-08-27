/**
 * issue #2277（D8 前半）—— composer 顶部上下文行：参与 agent 头像串 + skill +
 * 已引用上下文 + 更多设置（禁用+说明）。只测**有真实数据支撑**的三项渲染逻辑，
 * 不测「输出落点」「改派建议」——那两项本仓没有数据源，未实现（见 #2278）。
 *
 * issue #2284（D8 剩余第三项）补两条真实数据源：
 * - 「已引用 N 项上下文」此前只数 composer 草稿里**尚未发送**的附件
 *   （`attach.attachments.length`），线程已经真实持有的「材料」（`materialsCount`，
 *   来自 `listThreadAttachments`）完全没算进去——草稿为空但材料非零的截图场景
 *   因此整行不渲染，与参照图不符。现在两者相加：草稿附件 + 已有材料，都是
 *   会随下一条消息一起「被引用」的真实上下文。
 * - 「已挂载 skill」此前是写死的泛化措辞。挂载时间窗数据（`skillMounts`/
 *   `skillNames`）已经在 #2273（D5 消息身份行）接入本组件，composer 行改为复用
 *   同一份数据解出「此刻」处于挂载状态的 skill 具体名字；解不出名字时（没传
 *   这两个 prop，或挂载刚发生名字还没到）保留原生的通用文案，不编名字。
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

  it("issue #2284：线程已有材料（materialsCount>0）时即使草稿没有新附件也渲染「已引用 N 项上下文」", async () => {
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} materialsCount={3}
      />,
    );
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-attachments")).toHaveTextContent("已引用 3 项上下文");
  });

  it("issue #2284：已有材料 + 草稿新增附件——两者相加，不是互相覆盖", async () => {
    uploadAttachment.mockResolvedValue({ id: "att-1", filename: "a.pdf", bytes: 1024, mime: "application/pdf" });
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} materialsCount={2}
      />,
    );
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-attachments")).toHaveTextContent("已引用 2 项上下文");

    const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("a.pdf")] } });
    await waitFor(() => expect(screen.getByTestId("chat-composer-context-attachments")).toHaveTextContent("已引用 3 项上下文"));
  });

  it("materialsCount 缺省（调用方未传）时按 0 处理，不是当作「没数据源」使整行报错或伪造", async () => {
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer-context-attachments")).toBeNull();
  });

  it("issue #2284：能解出「此刻」挂载的 skill 名字时显示具体名字，而非泛化的「已挂载 skill」", async () => {
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false}
        hasMountedSkills
        skillMounts={[
          { mountId: "mnt-1", threadId: "t", skillId: "skill-1", versionId: "v1", mountedAt: "2020-01-01T00:00:00.000Z", removedAt: null },
        ]}
        skillNames={new Map([["skill-1", "假设拆解"]])}
      />,
    );
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-skill")).toHaveTextContent("skill: 假设拆解");
  });

  it("issue #2284：skillMounts 里没有「此刻」有效的挂载窗口（已摘除）时回落泛化文案，不编名字", async () => {
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false}
        hasMountedSkills
        skillMounts={[
          {
            mountId: "mnt-1", threadId: "t", skillId: "skill-1", versionId: "v1",
            mountedAt: "2020-01-01T00:00:00.000Z", removedAt: "2020-01-02T00:00:00.000Z",
          },
        ]}
        skillNames={new Map([["skill-1", "假设拆解"]])}
      />,
    );
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    expect(screen.getByTestId("chat-composer-context-skill")).toHaveTextContent("已挂载 skill");
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
