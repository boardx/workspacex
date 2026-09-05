/**
 * Phase 14 F11（`artifacts-steering` 契约束 R3'，domain.md I-5/I-6，E3）—— 中途插话
 * 在内核侧（`checkPendingInterjection`/`classifyInterjection`）的反证套件。
 *
 * · 插话在"下一次工具调用之间"被消费，注入为最高优先级上下文——可断言的形状是：
 *   一条新的 `model_called` 账本记录，`planningNote` 原文带着插话文本，seq 落在
 *   触发它的那次工具调用之后、再下一次工具调用之前（R12："下一步执行路径需体现新指令"）。
 * · 插话绝不打断一次仍在进行中的工具调用（I-5）：`phase:"in_progress"` 事件之后，
 *   插话尚未被消费；只有该次调用的终态事件之后才会被消费。
 * · 插话被判定为"方向性改变"时，本 run 内此前"都允许"的 L2 授权整体失效，下一次同类
 *   L2 调用重新走一次授权确认，不沿用旧授权（E3）；判定为"局部调整"时授权不受影响。
 *
 * 沿用 `risk-tiering-and-states.test.ts` 已验证过的纯内存 fake 模式：这里断言的是状态机
 * 与调用时序，不需要真库（同 F06 verification 的既有先例）。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { createInMemoryInterjectionStore } from "../../src/application/agent-run/interjection-store";
import { classifyInterjection } from "../../src/application/agent-run/interjection-handling";
import {
  DEEP_AGENT_PROVIDER_NAME,
  type AgentRunStore, type AppendedRunStep, type ClaimedAgentRun, type ClaimOutcome,
  type ModelCallInput, type ModelCallPort, type PinnedSkillContent, type RunLocator, type RunProjection,
  type ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-f11-interjection");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "跑一个任务", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent", pendingDecision: null,
    disableTaskAutoClassify: false,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun, laterClaims: readonly ClaimedAgentRun[] = []): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly markAwaitingCalls: number;
  readonly approveCalls: number;
} {
  const state = { steps: [] as AppendedRunStep[], markAwaitingCalls: 0, approveCalls: 0 };
  // #2755：第一次 claim 给 `run`，之后按顺序给 `laterClaims`（模拟 HITL 之后 requeue 再被
  // 认领的 resume 续跑——`executeClaimed` 会被第二次调用、构造第二个 ModelCallInput），
  // 用完给空数组。
  const claims = [run, ...laterClaims];
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get steps() { return state.steps; },
    get markAwaitingCalls() { return state.markAwaitingCalls; },
    get approveCalls() { return state.approveCalls; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => {
      const next = claims.shift();
      return next === undefined ? [] : [{ kind: "executable", run: next }];
    },
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async () => {},
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async () => {},
    failRun: async () => { throw new Error("unexpected failRun in this test"); },
    async markAwaitingToolPermission() { state.markAwaitingCalls += 1; },
    async approveAndRequeue() { state.approveCalls += 1; return true; },
    denyAndRequeue: unused("denyAndRequeue"),
    editAndRequeue: unused("editAndRequeue"),
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
    readRunTranscriptSteps: async () => null,
  };
}

function deps(
  runs: AgentRunStore, model: ModelCallPort,
  extra: Pick<ExecuteAgentRunDeps, "toolPermissionGrants" | "interjections"> = {},
): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model, ...extra,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
}

describe("Phase 14 F11 -- classifyInterjection（简单确定性启发式，A2/E3：不规定算法）", () => {
  it("局部调整：普通追加指令判为 adjustment", () => {
    expect(classifyInterjection("把第二页标题改成蓝色")).toBe("adjustment");
  });

  it("方向性改变：命中换方向信号词判为 direction_change", () => {
    expect(classifyInterjection("算了，换个方向做别的")).toBe("direction_change");
    expect(classifyInterjection("其实我想要一份 PPT，不是 PDF")).toBe("direction_change");
  });
});

describe("Phase 14 F11 -- 插话在下一次工具调用之间被消费，不打断进行中的调用（I-5/R12）", () => {
  it("phase:in_progress 时插话尚未被消费；该次调用终态之后才消费，且体现在下一条 execution step 里", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, {
      interjectionId: "itj-1", text: "把第二页标题改成 X", receivedAt: "2026-09-05T00:00:00.000Z",
    });

    let interjectionSeenWhileInProgress = false;
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, onProgress) => {
        // 第一次工具调用"进行中"事件——此刻插话还不该被消费（I-5：不打断进行中的调用）。
        await onProgress({
          toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: null, planningNote: null,
          phase: "in_progress", toolCallId: "call-1",
        });
        interjectionSeenWhileInProgress = store.steps.some((s) => s.planningNote?.includes("把第二页标题改成 X"));
        // 同一次调用的终态事件——插话检查点在这里，之后才可能被消费。
        await onProgress({
          toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: "文件内容", planningNote: null,
          phase: "complete", toolCallId: "call-1",
        });
        // 下一次工具调用——若插话已被上一步消费，这里不会再触发第二次消费。
        await onProgress({ toolName: "grep", toolArgsSummary: "{}", toolResultSummary: "命中 3 处", planningNote: null });
        return { text: "读完了。" };
      },
    };

    await executeQueuedRuns(deps(store, model, { interjections }), { orgId: ORG });

    // 进行中态时，插话消费产生的记录还不存在（此刻账本已有 accepted/context_built/
    // read_file 自己的 in_progress 行，但都不含插话文本——插话检查点还没被触发）。
    expect(interjectionSeenWhileInProgress).toBe(false);

    const toolSteps = store.steps.filter((s) => s.kind === "tool_call");
    const interjectionSteps = store.steps.filter(
      (s) => s.kind === "model_called" && s.planningNote?.includes("把第二页标题改成 X"),
    );
    expect(interjectionSteps).toHaveLength(1);
    // 体现在"下一条 execution step"：seq 落在 read_file 终态行之后、grep 之前。
    const readFileTerminalSeq = toolSteps.find((s) => s.toolName === "read_file" && s.status === "succeeded")!.seq;
    const grepSeq = toolSteps.find((s) => s.toolName === "grep")!.seq;
    expect(interjectionSteps[0]!.seq).toBeGreaterThan(readFileTerminalSeq);
    expect(interjectionSteps[0]!.seq).toBeLessThan(grepSeq);
    // 已消费，不会在后续检查点里重复触发。
    expect(store.steps.filter((s) => s.planningNote?.includes("把第二页标题改成 X"))).toHaveLength(1);
  });

  it("没有待处理插话（或未注入 interjections 端口）：行为与 F06 之前逐字节相同，不多出任何记录", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: "内容", planningNote: null });
        return { text: "完成。" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG }); // 不传 interjections

    expect(store.steps.some((s) => s.kind === "model_called" && s.planningNote?.includes("已插话"))).toBe(false);
  });
});

describe("Phase 14 F11 -- E3：方向性改变使本 run 内的 L2 授权范围产生歧义，重新走授权确认", () => {
  it("方向性改变的插话 ⇒ 撤销本 run 内已授权的 call_skill ⇒ 下一次同类 L2 调用重新进 awaiting_tool_permission", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, {
      interjectionId: "itj-2", text: "算了，换个方向，直接生成 PPT", receivedAt: "2026-09-05T00:00:00.000Z",
    });

    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({
        text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" },
      }),
    };

    await executeQueuedRuns(deps(store, model, { toolPermissionGrants: grants, interjections }), { orgId: ORG });

    // 旧授权本来会自动放行（同 risk-tiering-and-states.test.ts 的对照用例），
    // 但方向性改变让它的范围产生歧义——必须重新走一次授权确认，不能沿用旧授权。
    expect(store.markAwaitingCalls).toBe(1);
    expect(store.approveCalls).toBe(0);
    expect(await grants.hasGrant(ORG, run.runId, "call_skill")).toBe(false);
    const interjectionStep = store.steps.find((s) => s.planningNote?.includes("换个方向"));
    expect(interjectionStep).toBeDefined();
    const awaitingStep = store.steps.find((s) => s.planningNote?.includes("等待人工批准"));
    // 插话的消费必须发生在授权判定之前（seq 更小），这样撤销才来得及影响这次判定。
    expect(interjectionStep!.seq).toBeLessThan(awaitingStep!.seq);
  });

  it("局部调整的插话 ⇒ 不撤销授权 ⇒ 仍按 R4 A2 自动放行（对照组：不是每条插话都清空授权）", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, {
      interjectionId: "itj-3", text: "字体再小一号", receivedAt: "2026-09-05T00:00:00.000Z",
    });

    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({
        text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" },
      }),
    };

    await executeQueuedRuns(deps(store, model, { toolPermissionGrants: grants, interjections }), { orgId: ORG });

    expect(store.approveCalls).toBe(1);
    expect(store.markAwaitingCalls).toBe(0);
    expect(await grants.hasGrant(ORG, run.runId, "call_skill")).toBe(true);
  });
});

describe("Phase 14 后续 A（#2755）-- 插话回灌内核：下一次 ModelCallInput 携带该插话，且同一插话只投递一次", () => {
  const RECEIVED_AT = "2026-09-05T00:00:00.000Z";

  it("interrupt 检查点消费的插话 ⇒ 自动放行后的 resume 调用带上 `interjection`（形状 = 契约 KernelInterjection）；再下一次 resume 不带", async () => {
    const run = baseRun();
    const approvedResume: ClaimedAgentRun = { ...run, pendingDecision: { kind: "approve" } };
    // 三次认领：① 新 run → 内核中断在 call_skill；② 自动放行后的 resume；③ 再一次 resume（对照：不再带）。
    const store = fakeStore(run, [approvedResume, approvedResume]);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, { interjectionId: "itj-k1", text: "字体再小一号", receivedAt: RECEIVED_AT });

    const inputs: ModelCallInput[] = [];
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (input) => {
        inputs.push(input);
        // 第一次：中断等授权（interrupt 检查点在这里消费插话）；之后的 resume：直接答完。
        return inputs.length === 1
          ? { text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" } }
          : { text: "完成。" };
      },
    };
    const d = deps(store, model, { toolPermissionGrants: grants, interjections });

    await executeQueuedRuns(d, { orgId: ORG }); // ① 中断 → 局部调整不撤销授权 → 自动放行 requeue
    expect(store.approveCalls).toBe(1);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toHaveProperty("interjection"); // 第一次调用时插话还没被消费

    await executeQueuedRuns(d, { orgId: ORG }); // ② resume 续跑：下一次 ModelCallInput
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.resume).toEqual({ decision: "approve" });
    expect(inputs[1]!.interjection).toEqual({
      interjectionId: "itj-k1", text: "字体再小一号", classification: "adjustment", receivedAt: RECEIVED_AT,
    });

    await executeQueuedRuns(d, { orgId: ORG }); // ③ 再一次 resume：同一插话不再投递
    expect(inputs).toHaveLength(3);
    expect(inputs[2]).not.toHaveProperty("interjection");
    expect(await interjections.takeStagedForKernel(ORG, run.runId)).toBeNull();
  });

  it("onProgress 终态检查点消费的插话 ⇒ 同一次内核调用随后中断时，resume 也带上它（classification 透传 direction_change）", async () => {
    const run = baseRun();
    const store = fakeStore(run, [{ ...run, pendingDecision: { kind: "approve" } }]);
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, {
      interjectionId: "itj-k2", text: "算了，换个方向，直接生成 PPT", receivedAt: RECEIVED_AT,
    });

    const inputs: ModelCallInput[] = [];
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (input, onProgress) => {
        inputs.push(input);
        if (inputs.length > 1) return { text: "完成。" };
        await onProgress({ toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: "内容", planningNote: null });
        // read_file 是 L1，直接放行 requeue（不需要授权）。
        return { text: "", interrupted: { toolName: "read_file", argsSummary: "{}" } };
      },
    };
    const d = deps(store, model, { interjections });

    await executeQueuedRuns(d, { orgId: ORG });
    await executeQueuedRuns(d, { orgId: ORG });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.interjection).toEqual({
      interjectionId: "itj-k2", text: "算了，换个方向，直接生成 PPT", classification: "direction_change", receivedAt: RECEIVED_AT,
    });
  });

  it("内核收到之前又来一条并被消费 ⇒ 后者覆盖前者（R7：单槽，不排队）", async () => {
    const interjections = createInMemoryInterjectionStore();
    await interjections.stageForKernel(ORG, "run-x", { interjectionId: "a", text: "A", classification: "adjustment", receivedAt: RECEIVED_AT });
    await interjections.stageForKernel(ORG, "run-x", { interjectionId: "b", text: "B", classification: "adjustment", receivedAt: RECEIVED_AT });
    expect((await interjections.takeStagedForKernel(ORG, "run-x"))?.interjectionId).toBe("b");
    expect(await interjections.takeStagedForKernel(ORG, "run-x")).toBeNull();
  });

  it("没有插话 / 未注入 interjections 端口 ⇒ ModelCallInput 上 `interjection` 这个键根本不出现", async () => {
    const run = baseRun();
    const inputs: ModelCallInput[] = [];
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (input) => { inputs.push(input); return { text: "完成。" }; },
    };
    await executeQueuedRuns(deps(fakeStore(run), model), { orgId: ORG });
    await executeQueuedRuns(deps(fakeStore(run), model, { interjections: createInMemoryInterjectionStore() }), { orgId: ORG });
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(Object.keys(input)).not.toContain("interjection");
  });
});
