/**
 * 2026-08-14 回归测试——mermaid 图「最大化→编辑→保存」在个人线程 403：
 *
 * 「最大化」的 mermaid 图走的是同一条 `landAsArtifact` 后端路径，也应该受同一道
 * `canLandArtifacts` 能力门约束（`artifact-land-capability.test.ts` 钉死的既有设计：
 * 产物对个人线程是 `artifact.readonly`，不是禁用、是压根没有这个能力）。此前
 * `chat-live-message-panel.tsx` 把 `threadId`/`messageId`/`bearer` 无条件传给
 * `MarkdownMessage` → `ChatDiagramFabric`，个人线程里点保存会撞上后端角色门，
 * 403「当前身份没有写入权限」——这不是权限模型错了，是这个入口没接上已有的能力开关。
 *
 * `ChatDiagramFabric` 真实渲染依赖 fabric 建 canvas 的浏览器能力，jsdom 里连
 * `data-ready` 都产不出（VZ-fabric 系列既有测试头注已写明），这里不追真实渲染，
 * 换成一个只回显收到的 threadId/messageId/bearer 的探针——够钉住「接线」本身。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { listMessages, createMessage, getAgentRun, openAgentRunStream, openAsrDraftStream, generateFollowUpSuggestions } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  getAgentRun: vi.fn(),
  openAgentRunStream: vi.fn(() => new Promise<void>(() => {})),
  openAsrDraftStream: vi.fn(() => new Promise<never>(() => {})),
  // UIUX gap 2（真实追问建议）落地后，ChatLiveMessagePanel 挂载时会真实调用这个函数
  // （夹具里 `aiMessageWithDiagram` 是 agent 作者，命中「该请求建议」的判据）。
  // 同 `openAgentRunStream`/`openAsrDraftStream` 的既有处理：挂一个永不 resolve/reject
  // 的 promise——这个测试只钉「接线」本身（ChatDiagramFabric 收到的 props），不关心
  // 追问建议这条副作用链路走到哪一步。
  generateFollowUpSuggestions: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createMessage, landAsArtifact: vi.fn(), generateFollowUpSuggestions,
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()), getAgentRun,
}));
vi.mock("@/lib/agent-run-stream", () => ({ openAgentRunStream }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()), openAsrDraftStream,
}));

const chatDiagramFabricCalls: Array<{ threadId?: string; messageId?: string; bearer?: string }> = [];
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string; threadId?: string; messageId?: string; bearer?: string }) => {
    chatDiagramFabricCalls.push({ threadId: props.threadId, messageId: props.messageId, bearer: props.bearer });
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

const aiMessageWithDiagram = msg({
  id: "m-ai-diagram",
  authorKind: "agent",
  agentId: "agent-real",
  text: "```mermaid\nflowchart TD\n  A --> B\n```",
});

describe("mermaid 图最大化保存 —— 跟 canLandArtifacts 同一道门", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatDiagramFabricCalls.length = 0;
    createMessage.mockResolvedValue({ message: msg({ id: "m-h" }), agentRunId: "r", runStatus: "queued" });
  });

  it("canLandArtifacts=false（个人线程）：ChatDiagramFabric 收不到 threadId/messageId/bearer —— 退回本地演示，不会调 landAsArtifact 撞 403", async () => {
    listMessages.mockResolvedValue({ messages: [aiMessageWithDiagram], nextCursor: null });
    render(
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={false} />,
    );
    await screen.findByTestId("chat-ai-markdown");
    // UIUX gap 2（追问建议真实生成）落地后，agent 默认选中与建议拉取各自触发一次
    // 独立的 effect，偶发再多渲一轮这棵子树（ChatDiagramFabric 拿到的 props 完全
    // 相同，纯函数式重渲染，不是重新挂载/不产生用户可见差异）——这里不再钉死
    // 「只渲染一次」，钉的是「每一次渲染 ChatDiagramFabric 拿到的 props 都对」，
    // 这才是本文件真正要保护的行为（接线正确性，不是渲染次数）。
    expect(chatDiagramFabricCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of chatDiagramFabricCalls) {
      expect(call).toEqual({ threadId: undefined, messageId: undefined, bearer: undefined });
    }
  });

  it("canLandArtifacts=true（项目线程写角色）：ChatDiagramFabric 收到真实 threadId/messageId/bearer —— 可以真实持久化", async () => {
    listMessages.mockResolvedValue({ messages: [aiMessageWithDiagram], nextCursor: null });
    render(
      <ChatLiveMessagePanel threadId="t" bearer="b" agents={agents} archived={false} canLandArtifacts={true} />,
    );
    await screen.findByTestId("chat-ai-markdown");
    expect(chatDiagramFabricCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of chatDiagramFabricCalls) {
      expect(call).toEqual({ threadId: "t", messageId: "m-ai-diagram", bearer: "b" });
    }
  });
});
