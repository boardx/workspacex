/**
 * issue #3416（测试闭环 #3413 的第一个 DEFECT，真实模型 + 本地真栈实测）——
 * 「后端 `agent_runs.status = awaiting_tool_permission`，前端一个审批框都没有；
 *   步骤卡停在「进行中」、计时一直涨。无人值守就是永久卡死，而且它看起来像还在干活。」
 *
 * ## 根因（读代码取证，不是猜测）
 *
 * 审批卡的挂载条件（`copilotkit-v2-panel-body.tsx` 的 `pendingPermission`）有三个来源：
 *
 *   ① `tracePendingPermission` —— 事件流投影 `runTrace.events` 里最后一条 `kind:"status"`
 *      执行事件是 `awaiting_tool_permission`；
 *   ② `runRestore.status` —— `useCopilotKitV2RunRestore` 的**权威读**（`getAgentRun`）；
 *   ③ `reattachApproval` —— #3367 那条被拒裁决的重挂路径。
 *
 * **① 在生产里是一条死路。** 全仓 `grep` 可证：`status: "awaiting_tool_permission"` 这个
 * 形状的**执行事件**只存在于测试、mock 与 e2e 替身里，`apps/api` 的任何生产代码路径
 * 都不产生它——`agent_execution_events` 的写入口 `appendExecutionEvent` 只被
 * `tool_start` / `tool_end` / `text_delta` / `final_message` / `skill_activity` 调用，
 * 没有任何一处写 `kind:"status"`（唯一的 `kind:"status"` 来自
 * `legacy-execution-events.ts`，且只合成 succeeded/failed/cancelled 三个终态）。
 * 也就是说：**替身说的是上游不说的方言**，①「推流来源」从来没有在真实 wire 上生效过。
 *
 * **② 只在 `pendingRunId` 非空时启动**，而 `pendingRunId` 只有两个写入点：挂载 hydration
 * （`findPendingRunId`，即刷新 / 切走再切回）和 landing 交接的 `observedRunId`。
 * 用户在**这次挂载里**发一句话、run 撞上权限门时，两个写入点都不命中 ⇒ 权威读根本
 * 不发生 ⇒ 卡片不挂。服务端此刻写的是 `RUN_FINISHED`（见
 * `copilotkit-agui.controller.ts` 的 `outcome.kind === "awaiting_tool_permission"` 分支：
 * 「NOT an error……ending the run normally here」），前端只知道「这轮流结束了」，
 * **不知道它是停在一个门上**。
 *
 * 这同时解释了报告方观察到而**没有**归因的那一条：刷新之后同一个 run 再遇到两个门都
 * 正常实时弹出——因为刷新那一次挂载 hydration 把 `pendingRunId` 设上了，`runRestore`
 * 从此持有这条 run 的订阅与权威读，后续每个门都由 ② 接住。所以触发条件不是「第二个
 * 门」，而是「这一轮 run 是不是在本次挂载里开始的」。
 *
 * ## 判据落在哪
 *
 * 按 #3311 / #3367 的先例：判据是**用户在不刷新的情况下真的到达了可以授权的地方**，
 * 并且点下去真的把授权发了出去。不判「事件里多了个字段」也不判「组件存在」——本缺陷
 * 下服务端数据是全的、组件代码也在，那两种断言无法被证伪。
 *
 * ⚠ 自检纪律（同 #3367）：挂载那一刻线程里**没有**未回复且带 `agentRunId` 的消息 ⇒
 *   `findPendingRunId` 返回 null ⇒ `useCopilotKitV2RunRestore` 在挂载时**不启动**。
 *   恢复路径若在挂载时就跑起来，它那次权威读会自己把卡片挂上，测试就会假绿。
 *   带 `agentRunId` 的那条人类消息与真实服务端一样，是**这一轮 run 开始之后**才出现的。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, listCapabilities, fetchPlanLedger, retryPlanStep } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-gate", version: 1 })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
  fetchPlanLedger: vi.fn(),
  retryPlanStep: vi.fn(),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/lib/plan-control-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-control-api")>()),
  fetchPlanLedger, retryPlanStep,
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

import * as React from "react";
import { CopilotKit, useCopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

const THREAD_ID = "thr-gate";
const RUN_ID = "run-gate-1";
const PERMISSION_REQUEST_ID = "11111111-2222-4333-8444-666666666666";
/** 「重试任务」起的**新**一轮 run —— 契约 `retryPlanStep.out.runId` 回的真实 `agent_runs.id`。 */
const RETRY_RUN_ID = "run-gate-retry-2";

const fetchCalls: string[] = [];

class SilentWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1;
  static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 1;
  constructor(readonly url: string, readonly protocols?: string[]) { super(); }
  send(): void {}
  close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

type SubscriberParams = {
  input: unknown; state: unknown; event: unknown; agent: unknown; messages: readonly unknown[];
};
type AgentLike = {
  messages?: readonly unknown[];
  subscribers: Array<{
    onRunStartedEvent?: (params: SubscriberParams) => void;
    onRunFinishedEvent?: (params: SubscriberParams) => void;
  }>;
};
let agents: Readonly<Record<string, AgentLike>> = {};
function CoreProbe(): null {
  const { copilotkit } = useCopilotKit();
  React.useEffect(() => {
    agents = (copilotkit as unknown as { agents: Readonly<Record<string, AgentLike>> }).agents;
  });
  return null;
}

/**
 * 服务端在权限门上写到 wire 上的**全部**内容（`copilotkit-agui.controller.ts`
 * `outcome.kind === "awaiting_tool_permission"` 分支）：关掉执行消息，然后一条
 * `RUN_FINISHED`。**没有**任何 `kind:"status"` 执行事件——生产代码从不产生它，
 * 所以这里也一条都不发。这正是本缺陷能被证伪的前提。
 */
function emitRunLifecycle(kind: "started" | "finished"): void {
  /* wire 上的 `threadId`/`runId` 是**客户端** correlation id（服务端逐字回显），
     不是 `agent_runs.id`——见 `chat-host-interjection-run.ts` 头注。刻意用一个与
     真实 runId 不同的值，免得测试从 wire 上"白捡"到真实 runId。 */
  const input = {
    threadId: THREAD_ID, runId: "client-corr-1", messages: [], state: {},
    tools: [], context: [], forwardedProps: {},
  };
  for (const agent of Object.values(agents)) {
    for (const subscriber of agent.subscribers ?? []) {
      const params = { input, state: {}, event: { type: kind === "started" ? "RUN_STARTED" : "RUN_FINISHED", ...input }, agent, messages: agent.messages ?? [] };
      if (kind === "started") subscriber.onRunStartedEvent?.(params);
      else subscriber.onRunFinishedEvent?.(params);
    }
  }
}

/** 服务端权威事实：这条 run 停在待批态，持有一条有效的待批请求。 */
const AWAITING = {
  runId: RUN_ID, threadId: THREAD_ID, status: "awaiting_tool_permission",
  error: null, failureReason: null, resultMessageId: null,
  pendingApproval: {
    permissionRequestId: PERMISSION_REQUEST_ID,
    interrupt: null,
    toolName: "call_skill",
    argsSummary: '{"skill_stable_name":"web-research","task":"查最新行业数据"}',
  },
} as const;

function msg(id: string, authorKind: "human" | "agent", text: string, agentRunId: string | null, replyToMessageId: string | null) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId, replyToMessageId, createdAt: "2026-09-11T00:00:00.000Z",
  };
}

/** 挂载那一刻：一轮**已经答完**的旧对话。`findPendingRunId` → null ⇒ 恢复路径不启动。 */
const BEFORE_RUN = [
  msg("cm-0", "human", "你好", "run-old", null),
  msg("cm-0r", "agent", "你好，有什么可以帮你？", "run-old", "cm-0"),
];
/** 用户在**这次挂载里**又发了一句，服务端接受并建了 run；run 撞上权限门，尚无回复。 */
const AFTER_RUN_STARTED = [
  ...BEFORE_RUN,
  msg("cm-1", "human", "帮我查一下最新的行业数据", RUN_ID, null),
];

beforeEach(() => {
  vi.clearAllMocks();
  agents = {};
  vi.stubGlobal("WebSocket", SilentWebSocket);
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  listMessages.mockResolvedValue({ messages: BEFORE_RUN, nextCursor: null });
  getAgentRun.mockResolvedValue(AWAITING);
  // 默认没有计划账本 ⇒ 计划面板不渲染，前两条用例与它无关。
  fetchPlanLedger.mockRejectedValue(new Error("no ledger"));
  retryPlanStep.mockResolvedValue({ runId: RETRY_RUN_ID, auditEventId: "audit-1" });
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    fetchCalls.push(String(typeof input === "string" ? input : (input as { url?: string }).url ?? input));
    return new Response(JSON.stringify({ events: [], legacyEvents: [], nextSeq: null, items: [], messages: [], nextCursor: null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }));
});

async function reachGateInThisMount(): Promise<void> {
  render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CoreProbe />
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
  await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
  // 挂载 hydration 跑完（历史读回，`pendingRunId` 判定为 null——见上方自检纪律）。
  await waitFor(() => expect(listMessages).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  // 用户发出这一句，服务端接受并落库了带 `agentRunId` 的人类消息行。
  listMessages.mockResolvedValue({ messages: AFTER_RUN_STARTED, nextCursor: null });
  await act(async () => { emitRunLifecycle("started"); });
  // 服务端在权限门上结束这条 SSE 流：只有 RUN_FINISHED，没有任何状态事件。
  await act(async () => { emitRunLifecycle("finished"); });
}

describe("issue #3416 —— run 停在 awaiting_tool_permission 时，用户不刷新也必须看得到并点得了审批框", () => {
  it("本次挂载里发起的 run 撞上权限门：审批卡必须自己出现、可见、可点，并真的发出授权", async () => {
    await reachGateInThisMount();

    const card = await screen.findByTestId("tool-permission-card", undefined, { timeout: 5000 });
    expect(card).toBeVisible();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"]) {
      const button = screen.getByTestId(testId);
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
    }

    await act(async () => { fireEvent.click(screen.getByTestId("perm-run")); });
    await waitFor(() => {
      const decided = fetchCalls.find((url) => url.includes(PERMISSION_REQUEST_ID));
      expect(
        decided,
        "审批卡上的按钮点下去没有把授权请求发出去——用户看到的是一张点不动的卡片。"
          + `实际发出的请求：${JSON.stringify(fetchCalls)}`,
      ).toBeTruthy();
      expect(String(decided)).toContain(RUN_ID);
    });
  });

  /**
   * fail closed 的另一半：run 正常跑完（回复已落库、`findPendingRunId` 为 null）时
   * 绝不凭「流结束了」造一张卡片，也不该为此多打一次权威读——否则每一轮正常对话
   * 结束都会闪一下「正在恢复上次未完成的任务…」。
   */
  it("run 正常跑完、回复已落库 ⇒ 不弹卡片，也不做权威读", async () => {
    render(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2AgentSelectionProvider>
          <CoreProbe />
          <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
        </CopilotKitV2AgentSelectionProvider>
      </CopilotKit>,
    );
    await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
    await waitFor(() => expect(listMessages).toHaveBeenCalled());
    listMessages.mockResolvedValue({
      messages: [...AFTER_RUN_STARTED, msg("cm-1r", "agent", "这是查到的数据", RUN_ID, "cm-1")],
      nextCursor: null,
    });
    await act(async () => { emitRunLifecycle("started"); });
    await act(async () => { emitRunLifecycle("finished"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.queryByTestId("tool-permission-card")).toBeNull();
    /* 这一轮 run 没有任何理由被权威读——`findPendingRunId` 已经说了它答完了。
       （线程里更早那条 `run-old` 会被别的既有路径读到，与本条修法无关，所以按
       runId 精确断言，不用「一次都没调用过」。） */
    expect(getAgentRun.mock.calls.map((call) => call[0])).not.toContain(RUN_ID);
  });
});

/**
 * issue #3416 报告方实测的**真实触发路径**：run 不是用户在 composer 里发出来的，
 * 而是失败后点「重试任务」（`chat-task-workbench-failure-retry-step`）拉起来的。
 *
 * 这条路径比上面那条更彻底：`confirmPlan` / `resumePlanRun` / `retryPlanStep` 走的是
 * `acceptHumanMessage` + `executor.kick` 的 queued/tick 通路，**从不经过 AG-UI SSE 桥**
 * ——`use-plan-ledger-polling.ts` 头注引 `accept-message-plan-run-creator.ts` 的原话：
 * 这条续跑对浏览器 "invisible to a browser network monitor -- it is a server-to-server call"。
 * 也就是说这条 run 连 `RUN_STARTED`/`RUN_FINISHED` 都不会有，宿主面板**根本不知道
 * 有这么一条 run 存在**，审批卡的三个来源一个都不命中。
 *
 * 这同时解释了报告方看到而未归因的另一半：同一 run 的**第一个**门正常弹出（那一轮是
 * landing 交接的 `observedRunId` 把 `pendingRunId` 设上了），而那轮 run 判失败之后
 * `runRestore` 读到终态就收尾并清空 `pendingRunId` —— 此后这次挂载里再起的任何 run
 * 都是瞎的。所以触发条件既不是「第二个门」，也不是「重试后事件流没重新订阅」
 * （这条路径压根没有事件流可订阅）。
 */
const FAILED_LEDGER = {
  revision: 3, engineEpoch: 1, origin: "engine", steps: [], orphanedConstraints: [],
  phase: "failed",
  gate: { required: false, reason: "below_threshold" },
  progress: { completed: 0, total: 0, elapsedMs: 1000 },
  pendingApplyAtNextRun: false,
  runStatus: "failed", activeRunId: null,
  pausedAt: null, pauseRequestedAt: null, cancelRequestedAt: null,
  errorCode: "MODEL_CALL_FAILED", failureReason: null,
  failedStepId: null, stepsAreProposal: false, pendingPermissionRequestId: null,
} as unknown;

describe("issue #3416 —— 「重试任务」起的 run（不经过 AG-UI 事件流）撞上权限门", () => {
  it("点重试之后 run 停在待批态：审批卡必须自己出现、可见、可点", async () => {
    fetchPlanLedger.mockResolvedValue(FAILED_LEDGER);
    render(
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
        <CopilotKitV2AgentSelectionProvider>
          <CoreProbe />
          <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
        </CopilotKitV2AgentSelectionProvider>
      </CopilotKit>,
    );
    // 服务端权威事实：重试起的那条**新** run 停在待批态。
    getAgentRun.mockImplementation(async (runId: string) =>
      runId === RETRY_RUN_ID ? { ...AWAITING, runId: RETRY_RUN_ID } : { ...AWAITING, runId, status: "failed", pendingApproval: null });

    const retry = await screen.findByTestId("chat-task-workbench-failure-retry-step", undefined, { timeout: 5000 });
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(retryPlanStep).toHaveBeenCalled());

    const card = await screen.findByTestId("tool-permission-card", undefined, { timeout: 5000 });
    expect(card).toBeVisible();
    for (const testId of ["perm-once", "perm-run", "perm-always", "perm-deny"]) {
      const button = screen.getByTestId(testId);
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
    }

    // 点下去真的把这次授权发到了**重试起的那条 run** 上。
    await act(async () => { fireEvent.click(screen.getByTestId("perm-run")); });
    await waitFor(() => {
      const decided = fetchCalls.find((url) => url.includes(PERMISSION_REQUEST_ID));
      expect(decided, `授权请求没有发出去。实际发出的请求：${JSON.stringify(fetchCalls)}`).toBeTruthy();
      expect(String(decided)).toContain(RETRY_RUN_ID);
    });
  });
});
