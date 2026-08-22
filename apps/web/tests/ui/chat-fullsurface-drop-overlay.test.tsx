/**
 * #1492 —— 拖文件到 chat 主界面任意处（消息列表 + composer 整个可视区）触发全屏悬浮层，
 * 对标 Codex；「文件上传按钮」的简化/加速版本，不新增上传机制——松手仍走既有 `pickFiles`/
 * `uploadAttachment`。这个文件专测「面板级 drag 状态机」本身：
 *   · 拖到消息列表区域（不是 composer 本身）也弹悬浮层
 *   · 跨越多层子元素移动鼠标不闪烁（dragEnter/dragLeave 计数器）
 *   · 松手后文件真的走上传路径、落进 composer 附件列表
 *   · 归档线程不接拖拽
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "研究", presence: "present" as const }];

function pdf(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

function dataTransferWith(files: File[]): DataTransfer {
  // jsdom 没有真的 DataTransfer 拖拽实现，手搭一个只提供测试用到的 files 字段的最小替身。
  return { files, items: [], types: ["Files"] } as unknown as DataTransfer;
}

async function renderPanel(archived = false) {
  render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={archived} canLandArtifacts={false} />);
  await waitFor(() => expect(listMessages).toHaveBeenCalled());
}

describe("ChatLiveMessagePanel — 全屏拖拽上传悬浮层（#1492，对标 Codex）", () => {
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

  it("拖到消息列表区域（不是 composer 本身）也弹全屏悬浮层", async () => {
    await renderPanel();
    expect(screen.queryByTestId("chat-fullsurface-drop-overlay")).toBeNull();

    const scrollArea = screen.getByTestId("chat-message-scroll");
    fireEvent.dragEnter(scrollArea, { dataTransfer: dataTransferWith([]) });

    expect(screen.getByTestId("chat-fullsurface-drop-overlay")).toBeInTheDocument();
  });

  it("跨越多层子元素移动鼠标不闪烁——中途 leave+enter 到子元素，悬浮层始终不消失", async () => {
    await renderPanel();
    const panel = screen.getByTestId("chat-live-message-panel");
    const scrollArea = screen.getByTestId("chat-message-scroll");
    const input = screen.getByTestId("chat-message-input");

    // 进入面板 → 悬浮层出现。
    fireEvent.dragEnter(panel, { dataTransfer: dataTransferWith([]) });
    expect(screen.getByTestId("chat-fullsurface-drop-overlay")).toBeInTheDocument();

    // 鼠标从面板移到子元素（scrollArea）：真实浏览器里这会先在父元素触发一次 dragLeave
    // 再在子元素触发 dragEnter——同一层级的 enter/leave 应该抵消，悬浮层不该消失。
    fireEvent.dragLeave(panel, { dataTransfer: dataTransferWith([]) });
    fireEvent.dragEnter(scrollArea, { dataTransfer: dataTransferWith([]) });
    expect(screen.getByTestId("chat-fullsurface-drop-overlay")).toBeInTheDocument();

    // 再从 scrollArea 移到更深的 composer 输入框，同样的抵消模式。
    fireEvent.dragLeave(scrollArea, { dataTransfer: dataTransferWith([]) });
    fireEvent.dragEnter(input, { dataTransfer: dataTransferWith([]) });
    expect(screen.getByTestId("chat-fullsurface-drop-overlay")).toBeInTheDocument();

    // 真的离开整个面板（只 leave，不再有配对的 enter）→ 悬浮层才消失。
    fireEvent.dragLeave(input, { dataTransfer: dataTransferWith([]) });
    fireEvent.dragLeave(scrollArea, { dataTransfer: dataTransferWith([]) });
    fireEvent.dragLeave(panel, { dataTransfer: dataTransferWith([]) });
    expect(screen.queryByTestId("chat-fullsurface-drop-overlay")).toBeNull();
  });

  it("在消息列表区域松手 → 走既有上传路径，文件出现在 composer 附件列表", async () => {
    uploadAttachment.mockResolvedValue({
      id: "att-server-1", filename: "brief.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-01-01T00:00:00.000Z",
    });
    await renderPanel();
    const scrollArea = screen.getByTestId("chat-message-scroll");
    const file = pdf("brief.pdf");

    fireEvent.dragEnter(scrollArea, { dataTransfer: dataTransferWith([file]) });
    fireEvent.drop(scrollArea, { dataTransfer: dataTransferWith([file]) });

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith("t", file, "b", expect.any(Function)));
    expect(await screen.findByText("brief.pdf")).toBeInTheDocument();
    // 悬浮层随 drop 一并收起。
    expect(screen.queryByTestId("chat-fullsurface-drop-overlay")).toBeNull();
  });

  it("归档线程不接拖拽——不弹悬浮层", async () => {
    await renderPanel(true);
    const panel = screen.getByTestId("chat-live-message-panel");
    fireEvent.dragEnter(panel, { dataTransfer: dataTransferWith([]) });
    expect(screen.queryByTestId("chat-fullsurface-drop-overlay")).toBeNull();
  });
});
