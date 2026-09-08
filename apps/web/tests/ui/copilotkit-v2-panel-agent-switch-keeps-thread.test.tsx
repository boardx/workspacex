/**
 * issue #3028 —— 「在既有对话里换 agent」的反证测试。
 *
 * 修复前：`copilotkit-v2-panel.tsx` 用 `key={selectedAgentId ?? "__server_default__"}`
 * 把 `CopilotKitV2PanelBody` 整棵子树钉在「当前选中的 agent」上，换 agent = 卸载整个
 * body、挂载全新一份（新的本地 `threadId`、新的 `useAgent` 实例、空 `agent.messages`、
 * 在飞的 SSE 被杀）。用户因此无法在一条既有对话里改用另一个 agent —— 而旧屏
 * `chat-live-message-panel.tsx` 的 `AgentPicker` 一直就是「只改这一条消息发给谁，
 * 对话本身不动」。本修复是**恢复旧屏已有的行为**，不是发明新语义。
 *
 * 这个测试测「remount 与否」这个后果本身，不测实现细节：消息区里那条已落库的历史
 * 消息带一段 ```mermaid 围栏，`ChatDiagramFabric` 被换成带**真挂载**计数器的探针
 * （空依赖 `useEffect` 只在真挂载时 +1，纯重渲染不触发 —— 同
 * `copilotkit-v2-panel-canvas-no-remount-on-rerender.test.tsx` 的既有手法）。
 * 换 agent 之后计数必须仍是 1，历史消息仍在原处。
 *
 * 反证（实测记录在 PR 正文）：把 `key={selectedAgentId ?? "__server_default__"}`
 * 加回 `CopilotKitV2PanelBody`，本用例如实回红。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const diagramMountCount = vi.hoisted(() => ({ current: 0 }));
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: (props: { code: string }) => {
    const React = require("react");
    React.useEffect(() => {
      diagramMountCount.current += 1;
    }, []);
    return React.createElement("div", { "data-testid": "chat-diagram-fabric-probe" }, props.code);
  },
}));

const { listMessages, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(async () => ({
    messages: [
      {
        id: "cm-3028", authorKind: "agent" as const, authorId: "u", agentId: null,
        text: "HISTORY-3028-SENTINEL\n\n```mermaid\nflowchart TD\n  A --> B\n```",
        clientMessageId: null, agentRunId: "run-3028", replyToMessageId: null,
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  })),
  listCapabilities: vi.fn(async () => ([
    {
      id: "agent-alpha", orgId: "org-1", kind: "agent" as const, name: "Alpha Agent",
      scope: "org" as const, enabled: true, endpoint: null, abbr: "AL",
      duty: "第一个候选", disabledReason: null,
    },
    {
      id: "agent-beta", orgId: "org-1", kind: "agent" as const, name: "Beta Agent",
      scope: "org" as const, enabled: true, endpoint: null, abbr: "BE",
      duty: "第二个候选", disabledReason: null,
    },
  ])),
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
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId="thr-3028" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

function cardFor(agentId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="chat-task-workbench-capability-card"][data-agent-id="${agentId}"]`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  diagramMountCount.current = 0;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("copilotkit-v2-panel 在既有对话里换 agent（issue #3028）", () => {
  it("换 agent 不卸载对话主体：历史仍在，消息子树的真挂载次数仍是 1", async () => {
    mount();
    await screen.findByTestId("chat-diagram-fabric-probe");
    await waitFor(() => expect(diagramMountCount.current).toBe(1));
    expect(screen.getByTestId("copilotkit-v2-messages")).toHaveTextContent("HISTORY-3028-SENTINEL");

    fireEvent.click(await screen.findByTestId("chat-task-workbench-capability-picker"));
    await waitFor(() => expect(cardFor("agent-beta")).not.toBeNull());
    fireEvent.click(cardFor("agent-beta")!);

    // 选择真的生效（触发器上显示的是新选中的 agent）——不是点了个没反应的按钮。
    await waitFor(() =>
      expect(screen.getByTestId("chat-task-workbench-capability-picker")).toHaveTextContent("Beta Agent"),
    );

    // ── 反证：对话主体没有被卸载重建，历史消息还在原处 ────────────────────────
    expect(diagramMountCount.current).toBe(1);
    expect(screen.getByTestId("copilotkit-v2-messages")).toHaveTextContent("HISTORY-3028-SENTINEL");
  });
});
