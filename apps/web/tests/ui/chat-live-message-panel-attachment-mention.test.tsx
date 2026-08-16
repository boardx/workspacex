/**
 * 人类实测反馈：composer 里能用 `#` 唤 skill（已合入 main），但没有 `@` 引用本线程
 * 已上传过的文件。这个文件钉住新加的 `@` mention 检测状态机 + 插入行为——
 * **不需要任何后端调用**：候选来自已加载消息的 `attachments` 去重，选中后只是把
 * 文件名当纯文本插进正文，靠 F155 file-retrieval 的 `search_tsv`（已把 filename
 * 编进检索索引）自然召回，不碰 `attachmentIds`/契约。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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

function setup() {
  listMessages.mockResolvedValue({
    messages: [
      msg({
        id: "m-1", authorKind: "agent", agentId: "agent-real",
        text: "已经处理完了", attachments: [{ id: "att-1", filename: "报告.pdf", bytes: 100, mime: "application/pdf" }],
      }),
    ],
    nextCursor: null,
  });
  return render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
}

describe("ChatLiveMessagePanel — @ 引用本线程已上传附件", () => {
  beforeEach(() => vi.clearAllMocks());

  it("打 @ 后弹出候选（按已加载消息的附件去重），按文件名过滤，选中后把文件名插进正文并清掉 query", async () => {
    setup();
    const input = (await screen.findByTestId("chat-message-input")) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "帮我看看 @报" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyUp(input, { key: "告" });

    const picker = await screen.findByTestId("chat-attachment-mention-picker");
    expect(within(picker).getByTestId("chat-attachment-mention-query").textContent).toContain("报");
    const option = within(picker).getByTestId("chat-attachment-mention-option-att-1");
    expect(option.textContent).toBe("报告.pdf");

    fireEvent.click(option);

    expect(input.value).toBe("帮我看看 @报告.pdf ");
    expect(screen.queryByTestId("chat-attachment-mention-picker")).toBeNull();
  });

  it("没有匹配的文件名时显示诚实空态，不隐藏整个下拉", async () => {
    setup();
    const input = (await screen.findByTestId("chat-message-input")) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "@不存在的文件名" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyUp(input, { key: "名" });

    const picker = await screen.findByTestId("chat-attachment-mention-picker");
    expect(within(picker).getByTestId("chat-attachment-mention-no-match")).toBeTruthy();
    expect(within(picker).queryByTestId("chat-attachment-mention-option-att-1")).toBeNull();
  });

  it("`#` 与 `@` 只有离光标更近的那个生效——不会同时弹两个下拉", async () => {
    setup();
    const input = (await screen.findByTestId("chat-message-input")) as HTMLTextAreaElement;

    // "@报告 #检" —— 光标在末尾，`#` 比 `@` 更靠近光标，只有 `#` 的 query 应该生效。
    fireEvent.change(input, { target: { value: "@报告 #检" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyUp(input, { key: "检" });

    expect(screen.queryByTestId("chat-attachment-mention-picker")).toBeNull();
  });

  it("触发字符后出现空白，mention 结束——不再弹出下拉", async () => {
    setup();
    const input = (await screen.findByTestId("chat-message-input")) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "@报告 然后" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyUp(input, { key: " " });

    expect(screen.queryByTestId("chat-attachment-mention-picker")).toBeNull();
  });

  it("线程里还没有任何附件时，打 @ 显示诚实空态而不是隐藏下拉", async () => {
    listMessages.mockResolvedValue({
      messages: [msg({ id: "m-1", authorKind: "agent", agentId: "agent-real", text: "你好" })],
      nextCursor: null,
    });
    render(<ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />);
    const input = (await screen.findByTestId("chat-message-input")) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyUp(input, { key: "@" });

    const picker = await screen.findByTestId("chat-attachment-mention-picker");
    expect(within(picker).getByTestId("chat-attachment-mention-pool-empty")).toBeTruthy();
  });
});
