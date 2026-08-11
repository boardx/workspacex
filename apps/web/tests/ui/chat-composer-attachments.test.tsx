/**
 * #946 · V9-a F152 —— 活路由 composer 附件 UI 的组件测试。
 *
 * 驱动真实 `chat-live-message-panel.tsx` + `chat-composer-attachments.tsx` 的状态机，只在
 * `@/lib/live-chat` 这层网络边界 mock（`uploadAttachment`/`createMessage`/`listMessages`），
 * 保留真实的 ATTACHMENT_LIMITS / 白名单常量（不在测试里另写一份签核值）。验证：
 *   · 📎 选文件 → 走真实上传端点、出预览条、发送带 attachmentIds
 *   · 客户端预检：超大小/非白名单**就地报错且不上传**（服务端仍权威，但快反馈）
 *   · 移除二次确认
 *   · 上传中禁用发送
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { listMessages, createMessage, uploadAttachment, getAgentRun, openAgentRunStream } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  uploadAttachment: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()), // 保留 ATTACHMENT_LIMITS / 白名单
  listMessages,
  createMessage,
  uploadAttachment,
  landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";
import { ATTACHMENT_LIMITS } from "@/lib/live-chat";

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", presence: "present" as const }];

function pdf(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

async function renderPanel() {
  render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
  await waitFor(() => expect(listMessages).toHaveBeenCalled());
}

function selectFiles(files: File[]) {
  const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("ChatLiveMessagePanel — composer 附件 UI（#946 V9-a F152）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    createMessage.mockResolvedValue({
      message: { id: "m-1", authorKind: "human", authorId: "u", agentId: null, text: "x", clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      agentRunId: "run-1", runStatus: "queued",
    });
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: "t", inputMessageId: "m-1", agentId: "agent-real", agentVersionId: "v1",
      skillVersionIds: [], modelProvider: "p", modelId: "m", status: "queued", error: null,
      resultMessageId: null, steps: [], createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("composer 里有 📎 附件按钮（活路由，非原型）", async () => {
    await renderPanel();
    expect(screen.getByTestId("chat-attachment-input")).toBeInTheDocument();
  });

  it("选文件 → 调真实上传端点、出预览条；发送把 serverId 作为 attachmentIds 传给 createMessage", async () => {
    uploadAttachment.mockResolvedValue({ id: "att-server-1", filename: "brief.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-01-01T00:00:00.000Z" });
    await renderPanel();

    await act(async () => { selectFiles([pdf("brief.pdf")]); });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith("t", expect.any(File), "b"));

    // 预览条出现且转为「已就绪」
    const list = await screen.findByTestId("chat-attachment-list");
    await waitFor(() => expect(within(list).getByText("已就绪")).toBeInTheDocument());
    expect(within(list).getByText("brief.pdf")).toBeInTheDocument();

    // 发消息 → attachmentIds 带上 server id
    fireEvent.change(screen.getByTestId("chat-message-input"), { target: { value: "看这个文件" } });
    fireEvent.click(screen.getByTestId("chat-message-submit"));
    await waitFor(() => expect(createMessage).toHaveBeenCalledTimes(1));
    expect(createMessage).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ text: "看这个文件", attachmentIds: ["att-server-1"] }),
      "b",
    );
    // 发送成功后 composer 附件清空
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-list")).not.toBeInTheDocument());
  });

  it("超单文件上限 → 就地报错(oversize)且不上传", async () => {
    await renderPanel();
    await act(async () => { selectFiles([pdf("huge.pdf", ATTACHMENT_LIMITS.maxBytesPerFile + 1)]); });
    const banner = await screen.findByTestId("chat-attachment-error");
    expect(banner).toHaveAttribute("data-error-kind", "oversize");
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-attachment-list")).not.toBeInTheDocument();
  });

  it("非白名单类型 → 就地报错(type)且不上传", async () => {
    await renderPanel();
    const evil = new File([new Uint8Array(8)], "app.exe", { type: "application/x-msdownload" });
    await act(async () => { selectFiles([evil]); });
    const banner = await screen.findByTestId("chat-attachment-error");
    expect(banner).toHaveAttribute("data-error-kind", "type");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("移除二次确认：点 ✕ 弹确认，点「移除」后预览条消失", async () => {
    uploadAttachment.mockResolvedValue({ id: "att-server-2", filename: "x.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-01-01T00:00:00.000Z" });
    await renderPanel();
    await act(async () => { selectFiles([pdf("x.pdf")]); });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalled());
    const list = await screen.findByTestId("chat-attachment-list");
    const removeBtn = within(list).getByRole("button", { name: /移除附件/ });
    fireEvent.click(removeBtn);
    // 确认框出现
    const confirm = await screen.findByRole("alertdialog", { name: "确认移除附件" });
    fireEvent.click(within(confirm).getByText("移除"));
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-list")).not.toBeInTheDocument());
  });

  it("上传中禁用发送（避免漏发未拿到 serverId 的附件）", async () => {
    // 让上传悬挂，附件停在 uploading 态
    uploadAttachment.mockReturnValue(new Promise(() => {}));
    await renderPanel();
    fireEvent.change(screen.getByTestId("chat-message-input"), { target: { value: "带附件" } });
    await act(async () => { selectFiles([pdf("pending.pdf")]); });
    await screen.findByTestId("chat-attachment-list");
    expect(screen.getByTestId("chat-message-submit")).toBeDisabled();
  });
});
