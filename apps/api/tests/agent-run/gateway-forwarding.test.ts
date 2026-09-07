/**
 * Phase 14 F01 (`kernel-gateway` 契约束 UC-1 `forwardRun` / UC-3 `checkKernelHealth`,
 * R3/R4 A1/I-3) -- 一次真实 run 全链路经网关（`execute-run.ts`）转发到内核
 * （`ModelCallPort.completeWithProgress`，生产接线里是 `DeepAgentModelProvider` →
 * `apps/deep-agent-service`）并正确回传结果。
 *
 * 沿用 `execute-run-progress.test.ts`/`execute-run-streaming.test.ts` 已验证过的纯内存
 * fake 模式：`execute-run.ts` 是纯函数式的应用层代码，唯一外部依赖是
 * `ExecuteAgentRunDeps` 的端口，这里断言的是"转发到内核、内核事件被账本旁路记录、
 * 结果被正确回传"这类调用时序，不是任何 SQL/RLS 行为，不需要真库。
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import {
  DEEP_AGENT_PROVIDER_NAME,
  type AgentRunStore, type AppendedRunStep, type ClaimOutcome, type ClaimedAgentRun,
  type ModelCallInput, type ModelCallPort, type PinnedSkillContent, type RunFailureCode,
  type RunLocator, type RunProjection, type ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";
import type { ExecutionEventInput } from "@repo/contracts/execution-journal";

const ORG = toOrgId("org-f01-gateway-forwarding");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "生成一个 PDF", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly output: { text: string; files: readonly unknown[] } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    output: null as { text: string; files: readonly unknown[] } | null,
    failedWith: null as RunFailureCode | null,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get steps() { return state.steps; },
    get output() { return state.output; },
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async () => {},
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async (
      _orgId, _runId, output: { text: string; files?: readonly unknown[] },
    ) => { state.output = { text: output.text, files: output.files ?? [] }; },
    failRun: async (_orgId, _runId, code: RunFailureCode) => { state.failedWith = code; },
    async markAwaitingToolPermission() { throw new Error("unexpected markAwaitingToolPermission in this test"); },
    async approveAndRequeue() { throw new Error("unexpected approveAndRequeue in this test"); return false; },
    async denyAndRequeue() { throw new Error("unexpected denyAndRequeue in this test"); return false; },
    async editAndRequeue() { throw new Error("unexpected editAndRequeue in this test"); return false; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    findAwaitingToolPermissionRunId: async (): Promise<string | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
    // Phase 14 F15 -- audit-only read this executor-focused fake never exercises.
    readRunTranscriptSteps: async () => null,
  };
}

function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: vi.fn(),
  };
}

describe("Phase 14 F01 -- 网关转发到内核（gateway → kernel forwarding）", () => {
  it.each([false, true])("attributes file-tool journal events only in a trusted native invocation (%s)", async native => {
    const store = fakeStore(baseRun({ leaseEpoch: 1 }));
    const events: ExecutionEventInput[] = [];
    store.appendExecutionEvent = async (_org, _run, event) => { events.push(event); };
    const model: ModelCallPort = {
      complete: async () => { throw new Error("progress provider expected"); },
      completeWithProgress: async (_input, progress) => {
        const event = { toolName: "read_file", toolCallId: "read-1", toolArgsSummary: '{"file_path":"/workspace/report.txt"}', planningNote: null, toolResultSummary: null };
        await progress({ ...event, phase: "in_progress" });
        await progress({ ...event, phase: "complete", toolResultSummary: "report", ok: true });
        return { text: "read completed" };
      },
    };
    const options = deps(store, model);
    if (native) {
      Object.assign(options, {
        nativeSessions: { provision: async () => ({ bindingId: "11111111-1111-4111-8111-111111111111", profile: "native-v1", policy: "native-v1" }), resolve: async () => { throw new Error("unused"); }, release: async () => {}, releaseForRun: async () => {} },
        nativeOutputs: { listFiles: async () => [] },
        planLedger: { getLatest: async () => null, recordRemoteRunId: async () => {} },
      });
    }
    await executeQueuedRuns(options, { orgId: ORG });
    expect(store.failedWith).toBeNull();
    const tools = events.filter(e => e.kind === "tool_start" || e.kind === "tool_end");
    expect(tools).toHaveLength(2);
    for (const event of tools) {
      if (native) expect(event).toMatchObject({ capability: { id: "WX-T002", source: { revision: "0.7.6" } } });
      else expect(event).not.toHaveProperty("capability");
    }
  });
  it.each(["paused", "cancelled"] as const)("releases a native pause only if database cancellation wins (%s)", async settled => {
    const store = fakeStore(baseRun({ leaseEpoch: 1 }));
    store.pauseAtCheckpoint = async () => settled;
    const release = vi.fn(async () => {}), releaseForRun = vi.fn(async () => {});
    const options = deps(store, {complete: async () => ({text:"",paused:true}),completeWithProgress: async () => ({text:"",paused:true})});
    Object.assign(options, {
      nativeSessions: {provision: async () => ({bindingId:"11111111-1111-4111-8111-111111111111",profile:"native-v1",policy:"native-v1"}),resolve:async()=>{throw new Error("unused");},release,releaseForRun},
      nativeOutputs:{listFiles:async()=>[]},planLedger:{getLatest:async()=>null,recordRemoteRunId:async()=>{}},
    });
    await executeQueuedRuns(options,{orgId:ORG});
    expect(store.failedWith).toBeNull(); expect(store.output).toBeNull();
    expect(release).not.toHaveBeenCalled();
    expect(releaseForRun).toHaveBeenCalledTimes(settled === "cancelled" ? 1 : 0);
  });
  it("一次真实 run 全链路经网关鉴权后转发到内核（completeWithProgress）并正确回传结果", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const seenInputs: ModelCallInput[] = [];
    const model: ModelCallPort = {
      complete: async () => { throw new Error("complete() must not be called on the deep-agent (kernel) path"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (input, onProgress) => {
        seenInputs.push(input);
        await onProgress({
          toolName: "call_skill", toolArgsSummary: '{"skill_stable_name":"pdf-export"}',
          toolResultSummary: "已生成 PDF", planningNote: "调用 pdf-export 生成文档",
        });
        return { text: "PDF 已生成，可以下载了。" };
      },
    };

    const executed = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(executed).toBe(1);
    expect(store.failedWith).toBeNull();
    expect(store.output?.text).toBe("PDF 已生成，可以下载了。");
    // R3 步骤 1-2：网关鉴权后转发——run 确实被转发（内核收到了这次调用，input 里带着
    // 这个 run 的 threadId/runId/orgId，见 kernel-gateway.ts UC-1 `forwardRun` 的 in 形状）。
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]?.threadId).toBe(run.threadId);
    expect(seenInputs[0]?.runId).toBe(run.runId);
    // R3 步骤 6：内核产生的事件（工具调用）经网关旁路落账本。
    const toolCallSteps = store.steps.filter((s) => s.kind === "tool_call");
    expect(toolCallSteps).toHaveLength(1);
    expect(toolCallSteps[0]).toMatchObject({ toolName: "call_skill", toolResultSummary: "已生成 PDF" });
  });

  it("R4 A1 / I-3：下发前健康检查未过 ⇒ 不发起下游调用，立即以 KERNEL_UNAVAILABLE 落终态（快速失败，不悬挂等超时）", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    let forwarded = false;
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "unavailable",
      completeWithProgress: async () => { forwarded = true; return { text: "should never run" }; },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(forwarded).toBe(false);
    expect(store.output).toBeNull();
    expect(store.failedWith).toBe("KERNEL_UNAVAILABLE");
    const failedStep = store.steps.find((s) => s.kind === "model_called");
    expect(failedStep).toMatchObject({ status: "failed", failureCode: "KERNEL_UNAVAILABLE" });
  });

  it("非 deep-agent 的 run（没有内核概念）不受健康检查门控——`checkKernelHealth` 缺席时照常转发", async () => {
    const run = baseRun({ modelProvider: "test-provider", modelId: "test-model" });
    const store = fakeStore(run);
    // No `checkKernelHealth` on this port -- same shape `ConfiguredModelProvider`/
    // `DeepResearchModelProvider`/`BailianImageProvider` have today.
    const model: ModelCallPort = { complete: async () => ({ text: "一次性回复" }) };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.failedWith).toBeNull();
    expect(store.output?.text).toBe("一次性回复");
  });

  it("内核在事件流中途报错：run 以该错误的码失败，已经报告过的工具调用步骤不被撤销", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: "部分结果", planningNote: null });
        const { ModelCallError } = await import("../../src/application/agent-run/ports");
        throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run ended with status \"error\"");
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    expect(store.steps.filter((s) => s.kind === "tool_call")).toHaveLength(1);
    expect(store.output).toBeNull();
  });
});
