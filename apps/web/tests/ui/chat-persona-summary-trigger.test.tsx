/**
 * G2 触发入口（design-delta chat-persona-roundtrip，签核选 A：composer 状态条）：
 *   ① `canLandArtifacts=true` 且线程有消息 ⇒ 「生成用户画像」按钮存在且可点，
 *      点击以（threadId, 最新消息 id, bearer）调 `summarizePersonaFromThread`，
 *      成功后重读消息流——新 assistant mindmap 消息进入消息面板并走
 *      `MarkdownMessage → ChatDiagramFabric` 通道（探针收到 mindmap 源码）。
 *   ② 失败原样回显 reasonCode（不糊「生成失败」）。
 *   ③ `canLandArtifacts=false`（观察者角色，2026-08-21 起个人线程恒为 true——
 *      见 `PERSONAL_THREAD_CAPABILITIES`）⇒ 按钮不渲染（同「落地为产物」的
 *      能力门规矩：不渲染，而不是渲染后禁用；本条只测组件在给定这个布尔时的
 *      行为，不断言哪种线程会得到这个值）。
 *   ④ 空线程 ⇒ 按钮禁用（契约 in.messageId 必传，没有锚点消息可传）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const {
  listMessages, createMessage, summarizePersonaFromThread, getAgentRun, openAgentRunStream, openAsrDraftStream,
} = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  summarizePersonaFromThread: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
  openAsrDraftStream: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createMessage, summarizePersonaFromThread, landAsArtifact: vi.fn(),
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()), getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()), openAsrDraftStream,
}));

const diagramProbeCodes: string[] = [];
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => {
    diagramProbeCodes.push(props.code);
    return null;
  },
}));

import { ChatLiveMessagePanel } from "@/components/chat/chat-live-message-panel";

const agents = [{ id: "agent-real", abbr: "AR", name: "真实 Agent", duty: "只读研究", roleLabel: "研究", presence: "present" as const }];

function msg(over: Record<string, unknown>) {
  return {
    id: "x", authorKind: "human", authorId: "u", agentId: null, text: "", clientMessageId: null,
    agentRunId: null, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

const seedMessages = [
  msg({ id: "m-1", text: "姓名: 陈静" }),
  msg({ id: "m-2", text: "## 目标和需求\n- 准时交付" }),
];

const MINDMAP_BODY = "```mermaid\nmindmap\n  root((用户画像 · 陈静))\n    用户描述\n```";
const personaMessage = msg({
  id: "pmsg-1", authorKind: "agent", agentId: null, authorId: "persona-summary", text: MINDMAP_BODY,
});

describe("生成用户画像 · composer 触发入口（G2，签核选 A）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diagramProbeCodes.length = 0;
  });

  it("①点击 ⇒ 以最新消息为锚调 summarizePersonaFromThread，成功后新 mindmap 消息进入消息流并渲染", async () => {
    listMessages
      .mockResolvedValueOnce({ messages: seedMessages, nextCursor: null })
      .mockResolvedValue({ messages: [...seedMessages, personaMessage], nextCursor: null });
    summarizePersonaFromThread.mockResolvedValue({
      artifactId: "a1", versionId: null, contentHash: null, mode: "draft", hasSource: false,
      sufficient: true, resultMessageId: "pmsg-1",
      provenanceBacklink: { conversationId: "t", messageId: "m-2", citations: [] },
    });

    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false}
        canLandArtifacts={true} projectId="p"
      />,
    );

    const trigger = await screen.findByTestId("chat-persona-summary-trigger");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(summarizePersonaFromThread).toHaveBeenCalledWith("t", "m-2", "b");
    });
    // 成功后软刷新——mindmap 围栏走既有 ChatDiagramFabric 通道（探针收到 mindmap 源）。
    await waitFor(() => {
      expect(diagramProbeCodes.some((c) => c.startsWith("mindmap"))).toBe(true);
    });
    expect(screen.queryByTestId("chat-persona-summary-error")).toBeNull();
  });

  it("②失败原样回显 reasonCode，不糊「生成失败」", async () => {
    listMessages.mockResolvedValue({ messages: seedMessages, nextCursor: null });
    summarizePersonaFromThread.mockRejectedValue(new ApiError(503, "STORAGE_UNAVAILABLE", undefined));

    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false}
        canLandArtifacts={true} projectId="p"
      />,
    );
    fireEvent.click(await screen.findByTestId("chat-persona-summary-trigger"));

    const error = await screen.findByTestId("chat-persona-summary-error");
    expect(error.textContent).toContain("STORAGE_UNAVAILABLE");
  });

  it("③canLandArtifacts=false ⇒ 按钮不渲染（能力门：不渲染，而不是禁用）", async () => {
    listMessages.mockResolvedValue({ messages: seedMessages, nextCursor: null });
    render(
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />,
    );
    await screen.findByTestId("chat-message-input");
    expect(screen.queryByTestId("chat-persona-summary-trigger")).toBeNull();
  });

  it("④空线程 ⇒ 按钮禁用（无锚点消息可传）", async () => {
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    render(
      <ChatLiveMessagePanel
        threadId="t" bearer="b" agents={agents} archived={false}
        canLandArtifacts={true} projectId="p"
      />,
    );
    const trigger = await screen.findByTestId("chat-persona-summary-trigger");
    expect(trigger).toHaveProperty("disabled", true);
  });
});
