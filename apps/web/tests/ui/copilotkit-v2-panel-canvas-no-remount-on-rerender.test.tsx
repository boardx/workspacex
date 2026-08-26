/**
 * issue #2132（真实 devapp 实测：打字/滚动时消息区画布内容闪烁）—— 反证测试。
 *
 * 根因（见 `copilotkit-v2-panel.tsx` 里 `V2AssistantMessageImpl` 的完整注释）：
 * `markdownRenderer`/`copyButton` 这两个 `assistantMessage` slot 的 静态类型是
 * `SlotValue<C> = C | string | Partial<ComponentProps<C>>`——直接传一个箭头函数
 * 落在 `C` 分支，框架把它当作**整个 slot 的替换组件类型本身**。每次
 * `V2AssistantMessageImpl` 重渲染都创建一个新的箭头函数 ⇒ 对 React 而言"组件类型
 * 变了"⇒ reconciler 判定整棵子树需要卸载重建，不是更新 ⇒ 子树里的
 * `ChatDiagramFabric`（fabric canvas）被真的销毁重造，这才是"闪烁"最直接的一层。
 *
 * 这个测试直接测"这条机制的后果"，不测实现细节：mock `ChatDiagramFabric` 为一个
 * 带挂载计数器的探针（`useEffect` 空依赖只在**真挂载**时 +1，纯重渲染不触发）——
 * 打字导致 `CopilotKitV2PanelBody` 反复重渲染后，探针的挂载次数必须停在 1，
 * 不能随每次按键增长。若 `markdownRenderer`/`copyButton` 退回未 `useCallback` 的
 * 内联箭头函数，这个断言会失败（每次按键 +1）——这正是本测试要防住的回归。
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
        id: "cm-1", authorKind: "agent" as const, authorId: "u", agentId: null,
        text: "```mermaid\nflowchart TD\n  A --> B\n```",
        clientMessageId: null, agentRunId: "run-1", replyToMessageId: null,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  })),
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
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(),
  }),
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
        <CopilotKitV2Panel chatThreadId="thr-2132" archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  diagramMountCount.current = 0;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("copilotkit-v2-panel 打字时消息里的画布不被重新挂载（issue #2132）", () => {
  it("敲 5 个字符后，画布探针的真实挂载次数仍是 1（不是随按键次数增长）", async () => {
    mount();
    await screen.findByTestId("chat-diagram-fabric-probe");
    await waitFor(() => expect(diagramMountCount.current).toBe(1));

    const input = await screen.findByTestId("copilotkit-v2-input");
    for (const ch of "hello") {
      fireEvent.change(input, { target: { value: (input as HTMLInputElement).value + ch } });
    }

    // 给可能的异步重渲染一个机会跑完，再断言挂载计数没有随按键增长。
    await waitFor(() => expect(screen.getByTestId("copilotkit-v2-input")).toHaveValue("hello"));
    expect(diagramMountCount.current).toBe(1);
  });
});
