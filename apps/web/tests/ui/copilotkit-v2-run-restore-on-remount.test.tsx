/**
 * session-switch task-state-loss fix —— 用户在一条会话里提交任务（比如"生成 PDF"）后
 * 切到另一个会话再切回来，此前会看不到任何"还在生成"的痕迹：切回即路由级重挂载，
 * `useAgent` 的内存态（`agent.isRunning`/流式内容）与那次挂载绑定的 SSE 一起被丢弃，
 * 挂载时的 hydration 又只回读已落库消息、不知道"上一轮有没有一个还没写回的 run"
 * （见 `copilotkit-v2-panel.tsx` 挂载 hydration effect 与 `lib/copilotkit-v2-run-restore.ts`
 * 文件头的完整取证）。
 *
 * 这条测试钉在真实的 `CopilotKitV2Panel` 上，复刻"切回"这个真实场景：挂载时
 * `listMessages` 只读到一条尚未回复的人类消息（带 `agentRunId`），断言：
 * ① 挂载后必须显示"生成中"一类指示（不是安静地什么都不显示，看起来像没提交过）；
 * ② 轮询 `getAgentRun` 到终态后，指示消失，服务端这期间真实写回的助手回复被拉回来
 *    渲染出来——不是假装完成，是真的把持久化数据捞回来。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-attach", version: 1 })),
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
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-restore";

function msg(
  id: string,
  authorKind: "human" | "agent",
  text: string,
  extra: { agentRunId?: string | null; replyToMessageId?: string | null } = {},
) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId: extra.agentRunId ?? null, replyToMessageId: extra.replyToMessageId ?? null,
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 服务端这期间真实写回的助手回复——只有 run 到终态之后 `listMessages` 才读得到。 */
let writtenBack = false;

beforeEach(() => {
  vi.clearAllMocks();
  writtenBack = false;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  listMessages.mockImplementation(async () => ({
    messages: [
      msg("cm-1", "human", "帮我把这份纪要生成一份 PDF", { agentRunId: "run-1" }),
      ...(writtenBack
        ? [msg("cm-2", "agent", "PDF 已生成，请查收。", { agentRunId: "run-1", replyToMessageId: "cm-1" })]
        : []),
    ],
    nextCursor: null,
  }));
});

describe("copilotkit-v2 切会话再切回 ⇒ 未写回的 run 状态不丢失", () => {
  it("挂载即显示生成中，轮询到终态后指示消失、真实写回的回复被拉回来渲染", async () => {
    let resolveCount = 0;
    getAgentRun.mockImplementation(async (runId: string) => {
      resolveCount += 1;
      expect(runId).toBe("run-1");
      if (resolveCount < 2) {
        return { runId: "run-1", threadId: THREAD_ID, status: "running", error: null, resultMessageId: null };
      }
      writtenBack = true;
      return { runId: "run-1", threadId: THREAD_ID, status: "succeeded", error: null, resultMessageId: "cm-2" };
    });

    mount();

    // ① 挂载后：切回的人不该看到"像从没提交过"——生成中指示必须出现。
    await screen.findByTestId("copilotkit-v2-running-indicator");
    expect(screen.getByTestId("copilotkit-v2-thinking-phase").textContent).toContain("恢复");

    // ② 轮询到终态：指示消失，服务端这期间真实写回的回复出现在消息区。
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    }, { timeout: 5000 });
    await screen.findByText("PDF 已生成，请查收。");
    expect(getAgentRun).toHaveBeenCalledWith("run-1", "b");
  });

  it("挂载时这个 run 其实早就是终态（用户切回来时后端已经写完了）⇒ 只多打一次 GET，不显示生成中", async () => {
    writtenBack = true;
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: THREAD_ID, status: "succeeded", error: null, resultMessageId: "cm-2",
    });

    mount();

    await screen.findByText("PDF 已生成，请查收。");
    // 一开始就没有回复缺口（挂载时 `listMessages` 已经带上 cm-2），`findPendingRunId`
    // 判定这条人类消息已有回复——不该触发任何轮询。
    await waitFor(() => expect(getAgentRun).not.toHaveBeenCalled());
    expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
  });

  /**
   * 2026-08-30（devapp 真实用户复现）—— 第一版 `onSettled` 是零参数回调，run 真的以
   * `failed` 收场时唯一动作是清空 `pendingRunId`：指示消失，用户看到的是自己那句话
   * 安静地没有任何回应，连错误提示都没有。这里钉住修复：`view.status === "failed"`
   * 时必须把服务端错误码经既有 `describeCopilotkitV2RunError` 译文显示在错误横幅里
   * （与 `send()` 失败路径同一个 `copilotkit-v2-error` 锚点），不是静默消失。
   */
  it("轮询到终态但 run 其实是 failed ⇒ 显示错误横幅，不是安静地什么都不发生", async () => {
    getAgentRun.mockResolvedValue({
      runId: "run-1", threadId: THREAD_ID, status: "failed",
      error: "MODEL_CALL_FAILED", resultMessageId: null,
    });

    mount();

    const banner = await screen.findByTestId("copilotkit-v2-error");
    expect(banner.textContent).toContain("模型这次没能返回可用结果");
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    });
  });

  /**
   * 2026-08-30 —— `gave-up`（`useCopilotKitV2RunRestore` 自己撑不住放弃，不是读到了
   * 终态）同一类此前静默消失的问题：401（bearer 过期）与 20 分钟 budget 耗尽都不该
   * 冒充"已确认失败"，但也不能什么都不说。这里用 401 分支验证（budget 耗尽走同一个
   * `setError` 调用，只是 `reason` 文案不同，不再重复起一条 20 分钟的计时器用例）。
   */
  it("轮询因 401 放弃（bearer 过期）⇒ 如实提示未能核实，不冒充成功也不冒充失败", async () => {
    getAgentRun.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", undefined));

    mount();

    const banner = await screen.findByTestId("copilotkit-v2-error");
    expect(banner.textContent).toContain("登录状态可能已过期");
    await waitFor(() => {
      expect(screen.queryByTestId("copilotkit-v2-running-indicator")).not.toBeInTheDocument();
    });
  });
});
