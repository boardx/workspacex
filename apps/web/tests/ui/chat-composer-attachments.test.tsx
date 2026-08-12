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
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith("t", expect.any(File), "b", expect.any(Function)));

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

  // ── 📎 → 「加材料进这一轮」面板（第一版从简；复用 Modal 壳） ──────────────
  it("点 📎 先弹「加材料进这一轮」面板，而非直接开系统文件框", async () => {
    await renderPanel();
    expect(screen.queryByTestId("chat-attach-material")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    const modal = await screen.findByTestId("chat-attach-material");
    expect(modal).toHaveAttribute("role", "dialog");
    expect(within(modal).getByText("加材料进这一轮")).toBeInTheDocument();
    expect(screen.getByTestId("chat-attachment-input")).toHaveAttribute("aria-expanded", "true");
  });

  it("面板里「从本机文件选择」才触发隐藏 file input", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    await screen.findByTestId("chat-attach-material");
    const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("chat-attach-material-pick"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("面板约束文案用已签 25MB（非原型 200MB）且不含未支持的「录音」", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    const dropzone = await screen.findByTestId("chat-attach-material-dropzone");
    const text = dropzone.textContent ?? "";
    expect(text).toContain(`${ATTACHMENT_LIMITS.maxBytesPerFile / (1024 * 1024)}`); // 25
    expect(text).not.toContain("200");
    expect(text).not.toContain("录音"); // 白名单无 audio
  });

  it("第一版砍掉的能力不留假占位：无勾选框、无 token/机密/即将上线字样", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    const modal = await screen.findByTestId("chat-attach-material");
    // 没有逐文件「勾选进上下文」控件
    expect(within(modal).queryByRole("checkbox")).not.toBeInTheDocument();
    // 没有被砍能力的占位文案（不做假开关）
    const text = modal.textContent ?? "";
    expect(text).not.toContain("即将上线");
    expect(text).not.toContain("qwen3-32b");
    expect(text).not.toContain("token");
  });

  it("面板：「取消」与关闭按钮都能关闭（复用 Modal 壳）", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    await screen.findByTestId("chat-attach-material");
    fireEvent.click(screen.getByTestId("chat-attach-material-cancel"));
    await waitFor(() => expect(screen.queryByTestId("chat-attach-material")).not.toBeInTheDocument());
    // 再开，点右上角关闭
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    await screen.findByTestId("chat-attach-material");
    fireEvent.click(screen.getByTestId("chat-attach-material-close"));
    await waitFor(() => expect(screen.queryByTestId("chat-attach-material")).not.toBeInTheDocument());
  });

  it("面板内选文件走真实上传，预览条与「本次已选」计数同步", async () => {
    uploadAttachment.mockResolvedValue({ id: "att-server-9", filename: "in-modal.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-01-01T00:00:00.000Z" });
    await renderPanel();
    fireEvent.click(screen.getByTestId("chat-attachment-input"));
    await screen.findByTestId("chat-attach-material");
    await act(async () => { selectFiles([pdf("in-modal.pdf")]); });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith("t", expect.any(File), "b", expect.any(Function)));
    expect(screen.getByTestId("chat-attach-material-selected-count").textContent).toContain("1");
    const list = await screen.findByTestId("chat-attach-material-list");
    expect(within(list).getByText("in-modal.pdf")).toBeInTheDocument();
  });

  it("上传显示真实进度条：onProgress(0.5) → 进度条 aria-valuenow=50 且「上传中 50%」", async () => {
    // 上报 50% 后挂起，让附件停在 uploading@50%
    uploadAttachment.mockImplementation((_t: string, _f: File, _b: string | undefined, onProgress?: (f: number) => void) => {
      onProgress?.(0.5);
      return new Promise<never>(() => {}); // 永不 resolve
    });
    await renderPanel();
    await act(async () => { selectFiles([pdf("uploading.pdf")]); });
    const list = await screen.findByTestId("chat-attachment-list");
    const bar = await within(list).findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(within(list).getByText(/上传中 50%/)).toBeInTheDocument();
  });
});
