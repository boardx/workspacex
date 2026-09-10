/**
 * issue #3261 —— **活路径**上的失败成因。
 *
 * ## 这条测试补的是哪一段缝
 *
 * PR #3229（issue #3211 ①）加了有界枚举 `AgentRunFailureReason`（8 值）+
 * `agent_runs.failure_reason` + 前端 `describeAgentRunFailure`，让横幅能说出「为什么」
 * 失败，而不是那句放之四海皆准的「模型这次没能返回可用结果」。**但它全部的门控都是
 * 单元测试**：`agent-run-failure-reason-copy.test.ts` 证明的是"给定成因，文案对"，
 * 一个字都没证明成因**真的走到了**产品面。
 *
 * 实测（issue #3261 取证）：
 *   - 刷新后走**权威读**的 `handleRunRestored` —— 带成因（`copilotkit-v2-panel-body.tsx`
 *     的 `outcome.view.failureReason`）；
 *   - 失败**当场**走 AG-UI `RUN_ERROR` → `copilotkit.subscribe({ onError })` 的活路径
 *     —— 不带成因。
 * ⇒ 同一个失败，刷新前后说的是两句不同的话。尤其 `executor_defect`（**我们自己的
 * 执行器抛异常**）在活路径上与「模型没给结果」逐字相同，线上没人分得开我们的 bug
 * 和模型的问题。
 *
 * ## 为什么钉在这一层，而不是再写一条 lib 单测
 *
 * 「单元层绿 ≠ 活路径对」正是这个 issue 本身的来历。所以这里挂的是**真实的**
 * `CopilotKitV2Panel`，错误也从**真实的** `@copilotkit/core` 错误总线发出——
 * 形状（`code: "agent_run_error_event"` + `context.runtimeErrorCode` +
 * `context.source: "onRunErrorEvent"`）逐字取自 core 的 `createAgentErrorSubscriber`
 * 收到 AG-UI `RUN_ERROR` 事件后调用 `emitError` 的那一处，不是我们自己编的形状。
 *
 * ⚠ 这条测试**不**能替代浏览器判决：SSE 传输（控制器 `write({ type: RUN_ERROR })`
 * → core 的 `onRunErrorEvent`）这一跳仍然只由 e2e
 * `chat-path-f1-failure-cause-distinguishable.spec.ts` 覆盖。本文件覆盖的是它下游的
 * 那一跳：**错误总线 → 横幅正文**。
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

import * as React from "react";
import { CopilotKit, useCopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";
import { describeAgentRunError, describeAgentRunFailure } from "@/lib/agent-run";
import { RUN_RECOVERED_NOTICE } from "@/lib/copilotkit-v2-failure-banner";

const THREAD_ID = "thr-live-failure";
const RUN_ID = "run-live-1";

/** jsdom 里没有 WebSocket；恢复订阅只需要一个不推任何事件的空壳（本条不走恢复路径）。 */
class SilentWebSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1;
  static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 1;
  constructor(readonly url: string, readonly protocols?: string[]) { super(); }
  send(): void {}
  close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

/**
 * 拿到这次挂载真实的 `CopilotKitCore` 实例，供测试从**它自己的**错误总线发事件。
 * `emitError` 在 `.d.ts` 里是 TS-private，运行时就是 `CopilotKitCore` 上的普通方法
 * （`core/dist/index.mjs`：`async emitError({error, code, context}) { notifySubscribers(...onError...) }`）——
 * core 自己的 `createAgentErrorSubscriber` 收到 AG-UI `RUN_ERROR` 时调的正是它。
 */
type ErrorBus = {
  emitError(params: { error: Error; code: string; context?: Record<string, unknown> }): Promise<void>;
};
type AgentLike = { subscribers: Array<{ onCustomEvent?: (params: { event: unknown }) => void }> };
let errorBus: ErrorBus | null = null;
let agents: Readonly<Record<string, AgentLike>> = {};
function CoreProbe(): null {
  const { copilotkit } = useCopilotKit();
  React.useEffect(() => {
    errorBus = copilotkit as unknown as ErrorBus;
    agents = (copilotkit as unknown as { agents: Readonly<Record<string, AgentLike>> }).agents;
  });
  return null;
}

/**
 * 让面板知道「当前这一轮是哪个 run」——发一条**真实形状**的 durable execution 事件
 * （`AGUI_EXECUTION_EVENT_NAME` + `{ runId, kind: "status", status: "running" }`，
 * 与 `copilotkit-agui.controller.ts` 接受 run 后写上 wire 的那条逐字同形），
 * 走的是面板自己那份 `useRunTrace` 订阅，不是测试另塞一个 state。
 */
function emitRunAccepted(runId: string): void {
  const event = {
    name: "execution_event",
    value: { runId, seq: 0, kind: "status", status: "running", emittedAt: "2026-09-10T00:00:00.000Z" },
  };
  for (const agent of Object.values(agents)) {
    for (const subscriber of agent.subscribers ?? []) subscriber.onCustomEvent?.({ event });
  }
}

function msg(id: string, authorKind: "human" | "agent", text: string, agentRunId: string | null) {
  return {
    id, authorKind, authorId: "u", agentId: null, text, clientMessageId: null,
    agentRunId, replyToMessageId: null, createdAt: "2026-09-10T00:00:00.000Z",
  };
}

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CoreProbe />
        <CopilotKitV2Panel chatThreadId={THREAD_ID} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

/** 这一轮 run 在服务端的权威事实：失败了，且成因是「我们自己的执行器抛异常」。 */
const AUTHORITATIVE_VIEW = {
  runId: RUN_ID, threadId: THREAD_ID, status: "failed",
  error: "MODEL_CALL_FAILED", failureReason: "executor_defect", resultMessageId: null,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  errorBus = null;
  agents = {};
  vi.stubGlobal("WebSocket", SilentWebSocket);
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
  /*
   * ⚠ 线程里**没有**未回复的历史消息 —— 于是 `useCopilotKitV2RunRestore`（刷新/切回
   * 才走的那条恢复路径）根本不启动。这是刻意的：本文件要证的是**活路径**自己说得出
   * 成因，恢复路径若同时在跑，它那次权威读会把横幅写对，测试就会假绿。
   */
  listMessages.mockResolvedValue({ messages: [], nextCursor: null });
  getAgentRun.mockResolvedValue(AUTHORITATIVE_VIEW);
});

describe("issue #3261 —— 失败当场（活路径）的横幅必须说得出成因", () => {
  it("AG-UI RUN_ERROR 到达时，横幅说的必须与刷新后权威读说的是同一句话", async () => {
    mount();
    await waitFor(() => expect(errorBus).not.toBeNull());
    await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));

    // ① 服务端接受了这一轮 run（durable execution 事件上 wire）。
    emitRunAccepted(RUN_ID);
    const indicator = await screen.findByTestId("copilotkit-v2-running-indicator");
    await waitFor(() => expect(indicator.getAttribute("data-run-id")).toBe(RUN_ID));

    // ② 这一轮失败了：AG-UI `RUN_ERROR` → core 的错误总线（形状取自
    //    `createAgentErrorSubscriber.onRunErrorEvent`，不是我们自己编的）。
    await errorBus!.emitError({
      error: new Error("MODEL_CALL_FAILED"),
      code: "agent_run_error_event",
      context: {
        source: "onRunErrorEvent", runtimeErrorCode: "MODEL_CALL_FAILED",
        event: { type: "RUN_ERROR", message: "MODEL_CALL_FAILED", code: "MODEL_CALL_FAILED" },
      },
    });

    const banner = await screen.findByTestId("copilotkit-v2-error");
    const withCause = describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect");
    const withoutCause = describeAgentRunError("MODEL_CALL_FAILED");
    /* 自检：这两句必须真的不同，否则下面的断言是空转的。 */
    expect(withCause).not.toBe(withoutCause);

    await waitFor(() => {
      expect(
        banner.textContent,
        "活路径的横幅没有说出成因——刷新后（`handleRunRestored` 的权威读）说的是"
          + `「${withCause}」，失败当场说的是「${banner.textContent}」。`
          + "同一个失败在两条路径上不恒等，正是 issue #3261。",
      ).toContain(withCause);
    });

    /*
     * 成因只有**一个**来源：`agent_runs` 的权威读（与恢复路径同一个）。
     * 这条断言挡住「前端自己另猜一份成因」这种假修法。
     */
    expect(getAgentRun).toHaveBeenCalledWith(RUN_ID, "b");
  });

  it("权威读拿不到成因时，逐字回落到旧文案——不编一个成因出来", async () => {
    getAgentRun.mockResolvedValue({ ...AUTHORITATIVE_VIEW, failureReason: null });
    mount();
    await waitFor(() => expect(errorBus).not.toBeNull());
    await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
    emitRunAccepted(RUN_ID);
    await screen.findByTestId("copilotkit-v2-running-indicator");

    await errorBus!.emitError({
      error: new Error("MODEL_CALL_FAILED"),
      code: "agent_run_error_event",
      context: { source: "onRunErrorEvent", runtimeErrorCode: "MODEL_CALL_FAILED" },
    });

    const banner = await screen.findByTestId("copilotkit-v2-error");
    await waitFor(() => expect(banner.textContent).toContain(describeAgentRunError("MODEL_CALL_FAILED")));
  });

  /**
   * 传输层码（`THREAD_NOT_VISIBLE` 等）不是 run 的终态码，天然没有成因——文案必须
   * 逐字不变。（issue #3387 起它同样会补一次权威读，见该 issue；这里只钉文案。）
   */
  it("传输层错误码的文案不变", async () => {
    /*
     * issue #3387 起活路径对**每一个**码都补一次权威读。这一轮的权威事实是「run 还在
     * 跑」——既不是成功也不是失败终态 ⇒ 文案逐字回落到只按码说话的那句，与修改前一致。
     */
    getAgentRun.mockResolvedValue({
      runId: RUN_ID, threadId: THREAD_ID, status: "running",
      error: null, failureReason: null, resultMessageId: null,
    });
    mount();
    await waitFor(() => expect(errorBus).not.toBeNull());
    await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
    emitRunAccepted(RUN_ID);
    await screen.findByTestId("copilotkit-v2-running-indicator");

    await errorBus!.emitError({
      error: new Error("THREAD_NOT_VISIBLE"),
      code: "agent_run_error_event",
      context: { source: "onRunErrorEvent", runtimeErrorCode: "THREAD_NOT_VISIBLE" },
    });

    const banner = await screen.findByTestId("copilotkit-v2-error");
    await waitFor(() => expect(banner.textContent).toContain("这个对话你当前没有查看权限"));
  });
});

/**
 * issue #3387 ① —— **有产出 + run 成功 ⇒ 不得显示失败横幅**。
 *
 * 人类实测（devapp，2026-09-11）：回复正文已经给出几十行数据，执行条写
 * `执行过程 · 有失败步骤 · 历时 02:00 · 工具 17 次`（准确：17 次工具里 4 次失败后重试
 * 成功），底部却是红色横幅「这次执行没有成功，请重试或联系管理员」。
 *
 * ## 为什么钉在这一层
 *
 * 「横幅出不出」这件事只在**活面板**上成立：lib 单测判的是 `resolveLiveRunErrorOutcome`
 * 的返回值，宿主完全可以拿到 `recovered` 之后照样把红横幅留在屏幕上（`setError` 是
 * 先亮后撤的两步）。所以这里挂真实 `CopilotKitV2Panel`、从真实 `@copilotkit/core`
 * 错误总线发事件，断言的是 **DOM 里没有 `copilotkit-v2-error` 这个节点**。
 *
 * ## 判据抓的是组合，不是「横幅在不在」
 *
 * 单判「不出横幅」会把「run 真的失败了也不出横幅」一起判绿。所以同一个 describe 里
 * 配了一条对照：**同样的 wire 码、同样的面板，只把权威读换成 `failed`**，横幅必须出现。
 * 两条一起才说明判的是「run 的终态」，不是「有没有收到错误事件」。
 */
describe("issue #3387 ① —— 有产出 + run 成功 ⇒ 不得显示失败横幅", () => {
  const RESULT_MESSAGE_ID = "msg-result-1";
  /** 权威事实：这一轮成功了，产出已经写回落库（`resultMessageId` 非空）。 */
  const SUCCEEDED_WITH_OUTPUT = {
    runId: RUN_ID, threadId: THREAD_ID, status: "succeeded",
    error: null, failureReason: null, resultMessageId: RESULT_MESSAGE_ID,
  } as const;

  /** wire 上那个码：人类那一轮横幅逐字是通用兜底文案 ⇒ 码没被登记在任何一张表里。 */
  const WIRE_CODE = "SOME_UNREGISTERED_STEP_ERROR";

  async function mountAndFail(): Promise<void> {
    mount();
    await waitFor(() => expect(errorBus).not.toBeNull());
    await waitFor(() => expect(Object.keys(agents).length).toBeGreaterThan(0));
    emitRunAccepted(RUN_ID);
    const indicator = await screen.findByTestId("copilotkit-v2-running-indicator");
    await waitFor(() => expect(indicator.getAttribute("data-run-id")).toBe(RUN_ID));
    await errorBus!.emitError({
      error: new Error(WIRE_CODE),
      code: "agent_run_error_event",
      context: { source: "onRunErrorEvent", runtimeErrorCode: WIRE_CODE },
    });
  }

  it("run 落 succeeded 且产出已落库 ⇒ 失败横幅必须消失，代之以中性的完成提示", async () => {
    /* 线程里已经有这一轮的助手回复（「有产出」在产品面上的样子）。 */
    listMessages.mockResolvedValue({
      messages: [
        msg("m-user", "human", "2026 年新能源汽车销量如何？", null),
        msg(RESULT_MESSAGE_ID, "agent", "### 2026 年上半年（H1）整体表现\n- **产量**：743.8 万辆", RUN_ID),
      ],
      nextCursor: null,
    });
    getAgentRun.mockResolvedValue(SUCCEEDED_WITH_OUTPUT);

    await mountAndFail();

    /* 权威读必须真的发生过——否则下面「没有横幅」可能只是还没来得及亮。 */
    await waitFor(() => expect(getAgentRun).toHaveBeenCalledWith(RUN_ID, "b"));
    await waitFor(() => {
      const banner = screen.queryByTestId("copilotkit-v2-error");
      expect(
        banner,
        "agent_runs 的权威事实是 succeeded + resultMessageId 非空（产出已落库），"
          + `屏幕上却仍然挂着失败横幅「${banner?.textContent ?? ""}」——`
          + "这正是 issue #3387 ①：把「有失败步骤」说成了「这次执行没有成功」。",
      ).toBeNull();
    });
    /* 这一态有**自己的**表达，不是「什么都不显示」。 */
    const notice = await screen.findByTestId("copilotkit-v2-notice");
    expect(notice.textContent).toBe(RUN_RECOVERED_NOTICE);
    /* 完成态不该给「重试」——重试一条已经成功的 run 只会再烧一次真实模型调用。 */
    expect(screen.queryByTestId("copilotkit-v2-retry")).toBeNull();
  });

  it("对照：同一个码、权威读说 failed ⇒ 横幅照常出现（证明判的是 run 终态，不是「有没有收到错误事件」）", async () => {
    getAgentRun.mockResolvedValue({
      ...SUCCEEDED_WITH_OUTPUT, status: "failed", error: "MODEL_CALL_FAILED",
      failureReason: "executor_defect", resultMessageId: null,
    });
    await mountAndFail();
    const banner = await screen.findByTestId("copilotkit-v2-error");
    await waitFor(() => expect(banner.textContent)
      .toContain(describeAgentRunFailure("MODEL_CALL_FAILED", "executor_defect")));
    expect(screen.queryByTestId("copilotkit-v2-notice")).toBeNull();
  });
});
