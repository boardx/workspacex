/**
 * issue #2070 —— 钉住"画布/mermaid 保存后刷新丢失"这个 bug 的修复本身：
 * `copilotkit-v2-panel.tsx` 的 `assistantMessage` slot（`V2AssistantMessage`）曾经只把
 * `content` 转给 `MarkdownMessage`，从不传 `threadId`/`messageId`/`bearer`。三者当中
 * 任一缺失，画布组件的 `canPersist` 判定为 false，保存动作退回"本地演示"分支——只
 * 更新内存 state，从不调用 `landAsArtifact` 落库，刷新后编辑必然丢失。
 *
 * ⚠ 这个修复与 CK-P3（issue #2054，已合入 main）改的是**同一个** `assistantMessage`
 * slot——那次改动为「复制/评分/反馈」引入了 `V2AssistantMessage` 整组件替换 + 一份
 * "视图 id → 真实 chat_messages.id" 解析索引（`useChatMessageIdentity`）。本次复用
 * 同一份索引（不重新做一份平行的解析逻辑），只是把解析出的真实 id 连同 threadId/
 * bearer 一并喂给 `MarkdownMessage`。所以这里挂载**真实完整的** `CopilotKitV2Panel`
 * （不是重建一个 slot 替身组件）——两个 feature 的接线是否互不打架，只有整体挂载
 * 才测得出来。
 *
 * 钉住的三个具体假绿：
 * ① **messageId 用了错的命名空间**——用视图里的流式聚合 id 而不是解析出的真实
 *    `chat_messages.id`。断言的是"收到的 messageId 等于 `listMessages` 投影出的
 *    那一条"，不是"收到了某个非空字符串"。
 * ② **threadId 用了错的值**——`copilotkit-v2-panel.tsx` 内部有两个同名却不同义的
 *    "threadId"（本地 `useAgent` 的随机 id vs. 真实 `chat_threads.id`，文件头注反复
 *    强调是两个独立命名空间）。断言的是"收到的 threadId 等于外部传入的
 *    `chatThreadId`"，不是"收到了某个字符串"。
 * ③ **不可归因的历史消息也被当成可落地**——早于 `agent_run_id` 落库的历史消息不该
 *    解析出真实 id（同一条判据挡住了 CK-P3 的评分入口，也该挡住这里）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
vi.mock("@/lib/use-asr-draft", () => ({
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(),
    // issue #2130（TW-P0-5⑥）—— 补齐新字段，形状与真实 hook 一致；本测试场景
    // 不触发录音态，值本身不影响这里的断言。
    cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => <div data-testid="chat-diagram-fabric-probe">{props.code}</div>,
}));

const markdownMessageCalls: Array<{
  text: string;
  threadId: string | undefined;
  messageId: string | undefined;
  bearer: string | undefined;
}> = [];
vi.mock("@/components/chat/markdown-message", () => ({
  MarkdownMessage: (props: { text: string; threadId?: string; messageId?: string; bearer?: string }) => {
    markdownMessageCalls.push({
      text: props.text, threadId: props.threadId, messageId: props.messageId, bearer: props.bearer,
    });
    return <div data-testid="markdown-message-probe">{props.text}</div>;
  },
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-2070";

function msg(
  id: string,
  authorKind: "human" | "agent",
  text: string,
  agentRunId: string | null = null,
) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId, replyToMessageId: null, createdAt: "2026-08-26T00:00:00.000Z",
  };
}

function mount(props: { chatThreadId?: string | null } = {}) {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel
          chatThreadId={props.chatThreadId === undefined ? THREAD_ID : props.chatThreadId}
          archived={false}
          canGeneratePersona={false}
        />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  markdownMessageCalls.length = 0;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("copilotkit-v2-panel 的 assistantMessage slot —— threadId/messageId/bearer 真的到达 MarkdownMessage（issue #2070）", () => {
  it("可归因的 agent 消息：三者非 undefined，且 messageId 是解析出的真实 chat_messages.id", async () => {
    listMessages.mockImplementation(async () => ({
      messages: [
        msg("cm-1", "human", "帮我做一个用户旅程图"),
        msg("cm-2", "agent", "```mermaid\nflowchart TD\n  A --> B\n```", "run-1"),
      ],
      nextCursor: null,
    }));
    mount();

    await waitFor(() => {
      const call = markdownMessageCalls.find((c) => c.text.includes("flowchart TD"));
      expect(call).toBeDefined();
      expect(call).toEqual({
        text: "```mermaid\nflowchart TD\n  A --> B\n```",
        threadId: THREAD_ID,
        messageId: "cm-2",
        bearer: "b",
      });
    });
  });

  // 2026-09-02 —— 反转此前"不可归因 ⇒ messageId 为 undefined"的断言：这条 id 的下游
  // 是 `landAsArtifact`（图表保存 + G1 读回），服务端只要求消息真实存在、不看
  // `agentRunId`（`lib/copilotkit-v2-message-identity.ts` 对 `resolvePersisted` 的取证）。
  // 之前走评分专用的 `resolve`，这种消息里的图表「保存」被静默判成本地演示、刷新即丢。
  it("不可归因的历史消息（agentRunId 为 null）：messageId 仍是真实 chat_messages.id——落地不要求归因", async () => {
    listMessages.mockImplementation(async () => ({
      messages: [msg("cm-old", "agent", "这条早于 agent_run_id 落库", null)],
      nextCursor: null,
    }));
    mount();

    await waitFor(() => {
      const call = markdownMessageCalls.find((c) => c.text.includes("早于"));
      expect(call).toBeDefined();
      expect(call?.threadId).toBe(THREAD_ID);
      expect(call?.messageId).toBe("cm-old");
    });
  });

  it("新对话（chatThreadId=null，还没有真实线程）：threadId 如实是 undefined", async () => {
    listMessages.mockImplementation(async () => ({ messages: [], nextCursor: null }));
    mount({ chatThreadId: null });
    // 新对话没有历史可读回，直接确认页面正常挂载（没有可断言的 assistant 消息——
    // 这条用例钉的是"没有真实线程时不崩、不假装有 threadId"这件事本身通过挂载即证）。
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toBeTruthy());
    expect(markdownMessageCalls.every((c) => c.threadId === undefined)).toBe(true);
  });
});
