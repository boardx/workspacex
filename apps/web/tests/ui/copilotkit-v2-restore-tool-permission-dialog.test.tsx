/**
 * issue #3207 —— 「左上角出现了任务提醒，但确认弹窗没有在窗口里弹出来」。
 *
 * 根因是本仓反复出现的那一个形态：**同一事实声明在两处**。
 *
 * - 左上角那句「等待确认」由 `copilotkit-v2-panel-body.tsx` 的 `restoredPhaseLabel` /
 *   `runIsRunning` 给出，它读的是 `runRestore.status`——**权威 REST 读**（#2825 之后
 *   切回来先做权威读，见 `copilotkit-v2-run-restore.ts` 头注）。
 * - 而审批弹窗的挂载条件读的是 `activeTrace`，即 `runTrace.events[runId]` 里有没有一条
 *   `awaiting_tool_permission` 的 **status 推流事件**。
 *
 * 于是「切回会话 / 刷新 / 订阅建立晚于中断」这些情形下，run 明明停在
 * `awaiting_tool_permission`，权威读知道、提醒显示了，而那条 status 事件在这次挂载的
 * 订阅上永远不会再来——弹窗因此永不挂载。用户看得见「有事要我确认」，却没有可确认的界面。
 *
 * 本测试钉在真实 `CopilotKitV2Panel` 上，**不发任何 status 推流事件**，只让权威读回
 * `awaiting_tool_permission` + `pendingApproval`，断言：
 *   ① 左上角提醒出现（复刻人类看到的那一半，证明前提成立、不是没进入这个状态）；
 *   ② 审批弹窗真实渲染，且四个决策按钮**可见且可操作**（不是「元素存在」——#3207 的本质
 *      就是存在但用户看不到，所以这里断言 `toBeVisible()` 且按钮未被 disable）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-perm", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
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
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
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

const THREAD_ID = "thr-perm";

/** 订阅照旧建立，但**永远不推任何事件**——这正是 #3207 的现场：中断发生在这次挂载之前。 */
class SilentWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0;
  constructor(readonly url: string, readonly protocols: string[]) { super(); }
  send(): void {}
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event("close")); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event("open")); }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", class extends SilentWebSocket {
    constructor(url: string, protocols: string[]) { super(url, protocols); queueMicrotask(() => this.open()); }
  });
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  listMessages.mockImplementation(async () => ({
    messages: [{
      id: "cm-1", authorKind: "human", authorId: "u", agentId: null,
      text: "帮我查一下最新的行业数据", clientMessageId: null,
      agentRunId: "run-perm", replyToMessageId: null, createdAt: "2026-09-09T00:00:00.000Z",
    }],
    nextCursor: null,
  }));
  getAgentRun.mockResolvedValue({
    runId: "run-perm", threadId: THREAD_ID, status: "awaiting_tool_permission",
    error: null, resultMessageId: null,
    pendingApproval: {
      permissionRequestId: "11111111-2222-4333-8444-555555555555",
      interrupt: null,
      toolName: "call_skill",
      argsSummary: '{"skill_stable_name":"web-research","task":"查最新行业数据"}',
    },
  });
});

describe("issue #3207 —— 权威读说停在 awaiting_tool_permission 时，确认界面必须可见且可操作", () => {
  it("没有任何 status 推流事件，只有权威读：提醒出现，审批弹窗也必须出现并可点", async () => {
    render(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2AgentSelectionProvider>
          <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
        </CopilotKitV2AgentSelectionProvider>
      </CopilotKit>,
    );

    // ① 人类看到的那一半：左上角提醒（`restoredPhaseLabel` → "等待确认"）。
    const phase = await screen.findByTestId("copilotkit-v2-thinking-phase");
    await waitFor(() => expect(phase.textContent).toContain("等待确认"));

    // ② 人类没看到的那一半：确认界面。断言可见 + 可操作，不是「元素存在」。
    const card = await screen.findByTestId("tool-permission-card", undefined, { timeout: 5000 });
    expect(card).toBeVisible();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"]) {
      const button = screen.getByTestId(testId);
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
    }
  });
});
