/**
 * Phase 14 F06（`plan-permissions` 契约束 R5，domain.md I-1）—— 工具风险分级 + 状态机
 * 落点的反证套件。
 *
 * · `classifyToolRisk`：固定白名单映射，L0/L1/L2 与"未登记工具默认 L2"（I-1：没有例外，
 *   不认识的工具不能被默认放行）。
 * · L0 只读任务全程不出现 `awaiting_tool_permission`（纯 `onProgress` 汇报，从不触发
 *   `completion.interrupted`——L0/L1 本就"自动执行，不打断"，R5）。
 * · L2（`bash_exec`/`call_skill`）未获授权 ⇒ 恒进 `awaiting_tool_permission`，
 *   `approveAndRequeue` 零调用；拒绝后不继续执行（`denyAndRequeue` 而非 `failRun`，
 *   R3 步骤 6）。
 * · L2 已获授权（本 run 内 / 组织级以后都允许）⇒ 不再触发 `awaiting_tool_permission`，
 *   直接自动放行继续跑（R4 A2），但仍然落一条完整留痕的账本记录（I-3）。
 *
 * 沿用 `gateway-forwarding.test.ts` 已验证过的纯内存 fake 模式：`execute-run.ts` 唯一
 * 外部依赖是 `ExecuteAgentRunDeps` 的端口，这里断言的是状态机与调用时序，不需要真库。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { classifyToolRisk, isReadOnlyToolSet } from "../../src/domain/agent-run/tool-risk-tier";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import {
  DEEP_AGENT_PROVIDER_NAME,
  type AgentRunStore, type AppendedRunStep, type ClaimedAgentRun, type ClaimOutcome,
  type ModelCallInput, type ModelCallPort, type PinnedSkillContent, type RunFailureCode,
  type RunLocator, type RunProjection, type ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-f06-risk-tiering");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "跑一个任务", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly statusHistory: string[];
  readonly markAwaitingCalls: number;
  readonly approveCalls: number;
  readonly denyCalls: number;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    statusHistory: ["running"] as string[],
    markAwaitingCalls: 0,
    approveCalls: 0,
    denyCalls: 0,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get steps() { return state.steps; },
    get statusHistory() { return state.statusHistory; },
    get markAwaitingCalls() { return state.markAwaitingCalls; },
    get approveCalls() { return state.approveCalls; },
    get denyCalls() { return state.denyCalls; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async () => {},
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async () => {},
    failRun: async () => { throw new Error("unexpected failRun in this test"); },
    async markAwaitingToolPermission() {
      state.markAwaitingCalls += 1;
      state.statusHistory.push("awaiting_tool_permission");
    },
    async approveAndRequeue() {
      state.approveCalls += 1;
      state.statusHistory.push("queued");
      return true;
    },
    async denyAndRequeue() {
      state.denyCalls += 1;
      state.statusHistory.push("queued");
      return true;
    },
    editAndRequeue: async () => { throw new Error("unexpected editAndRequeue in this test"); },
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
  toolPermissionGrants?: ExecuteAgentRunDeps["toolPermissionGrants"],
): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs, model, toolPermissionGrants,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
}

describe("Phase 14 F06 -- classifyToolRisk（固定白名单，I-1 没有例外）", () => {
  it("L0：只读工具", () => {
    expect(classifyToolRisk("read_file")).toBe("L0");
    expect(classifyToolRisk("grep")).toBe("L0");
    expect(classifyToolRisk("web_fetch")).toBe("L0");
    expect(classifyToolRisk("list_org_skills")).toBe("L0");
  });

  it("L1：可撤销副作用", () => {
    expect(classifyToolRisk("write_file")).toBe("L1");
    expect(classifyToolRisk("edit_file")).toBe("L1");
  });

  it("L2：不可逆/高风险", () => {
    expect(classifyToolRisk("bash_exec")).toBe("L2");
    expect(classifyToolRisk("call_skill")).toBe("L2");
  });

  it("未登记的工具默认 L2——不认识的工具不能被默认放行", () => {
    expect(classifyToolRisk("some_never_seen_tool")).toBe("L2");
  });

  it("isReadOnlyToolSet：全 L0 才算纯只读", () => {
    expect(isReadOnlyToolSet(["read_file", "grep"])).toBe(true);
    expect(isReadOnlyToolSet(["read_file", "call_skill"])).toBe(false);
  });
});

describe("Phase 14 F06 -- L0/L1 只读任务全程不出现 awaiting_tool_permission", () => {
  it("纯 L0 工具调用（onProgress 汇报，从不 interrupted）：run 顺利完成，从未进入 awaiting_tool_permission", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: "文件内容", planningNote: null });
        await onProgress({ toolName: "grep", toolArgsSummary: "{}", toolResultSummary: "命中 3 处", planningNote: null });
        return { text: "读完了，一共命中 3 处。" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.markAwaitingCalls).toBe(0);
    expect(store.approveCalls).toBe(0);
    expect(store.statusHistory).not.toContain("awaiting_tool_permission");
    const toolSteps = store.steps.filter((s) => s.kind === "tool_call");
    expect(toolSteps.map((s) => s.toolName)).toEqual(["read_file", "grep"]);
  });
});

describe("Phase 14 F06 -- L2 未授权：恒进 awaiting_tool_permission，没有自动执行例外（I-1）", () => {
  it("bash_exec 未授权 ⇒ awaiting_tool_permission，approveAndRequeue 零调用", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, _onProgress) => ({
        text: "", interrupted: { toolName: "bash_exec", argsSummary: JSON.stringify({ cmd: "rm -rf /tmp/x" }) },
      }),
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.markAwaitingCalls).toBe(1);
    expect(store.approveCalls).toBe(0);
    expect(store.denyCalls).toBe(0);
    expect(store.statusHistory).toEqual(["running", "awaiting_tool_permission"]);
    const pendingStep = store.steps.find((s) => s.planningNote?.includes("等待人工批准"));
    expect(pendingStep?.planningNote).toContain("bash_exec");
  });

  it("call_skill 未授权 ⇒ 同样恒进 awaiting_tool_permission（agent 自认为风险低也不能绕过）", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({
        text: "", interrupted: { toolName: "call_skill", argsSummary: JSON.stringify({ skill_stable_name: "pdf-export", task: "x" }) },
      }),
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.markAwaitingCalls).toBe(1);
    expect(store.approveCalls).toBe(0);
  });
});

describe("Phase 14 F06 -- L2 已授权（run/forever）：R4 A2 不再触发确认，直接自动放行", () => {
  it("本次 run 内已授权同类操作 ⇒ 自动 approveAndRequeue，不进 awaiting_tool_permission", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({
        text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" },
      }),
    };

    await executeQueuedRuns(deps(store, model, grants), { orgId: ORG });

    expect(store.approveCalls).toBe(1);
    expect(store.markAwaitingCalls).toBe(0);
    expect(store.statusHistory).not.toContain("awaiting_tool_permission");
    // I-3：自动放行也要落一条完整留痕的账本记录，不是静默跳过。
    const autoStep = store.steps.find((s) => s.planningNote?.includes("自动放行"));
    expect(autoStep?.planningNote).toContain("call_skill");
  });

  it("组织级『以后都允许』⇒ 同样自动放行，且跨 run 生效（换一个 runId 依然命中）", async () => {
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantStanding(ORG, "bash_exec", "user-admin");

    const runA = baseRun({ runId: "run-a" });
    const storeA = fakeStore(runA);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({ text: "", interrupted: { toolName: "bash_exec", argsSummary: "{}" } }),
    };
    await executeQueuedRuns(deps(storeA, model, grants), { orgId: ORG });
    expect(storeA.approveCalls).toBe(1);
    expect(storeA.markAwaitingCalls).toBe(0);

    // 换一个从未见过的 run——"以后都允许"是组织级、跨 run 生效，不是那一次 run 的偶然。
    const runB = baseRun({ runId: "run-b" });
    const storeB = fakeStore(runB);
    await executeQueuedRuns(deps(storeB, model, grants), { orgId: ORG });
    expect(storeB.approveCalls).toBe(1);
    expect(storeB.markAwaitingCalls).toBe(0);
  });

  it("『本次 run 内』授权不越界到另一个 run（I-4：授权粒度互不越界）", async () => {
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, "run-only-this-one", "call_skill");

    const otherRun = baseRun({ runId: "run-different" });
    const store = fakeStore(otherRun);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({ text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" } }),
    };

    await executeQueuedRuns(deps(store, model, grants), { orgId: ORG });

    // 没有命中——不同 run，仍然要停下来等人裁决。
    expect(store.markAwaitingCalls).toBe(1);
    expect(store.approveCalls).toBe(0);
  });
});
