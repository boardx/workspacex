import { expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import {
  DEEP_AGENT_PROVIDER_NAME,
  type AgentRunStore, type AppendedRunStep, type ClaimedAgentRun, type ClaimOutcome,
  type ModelCallInput, type ModelCallPort, type PinnedSkillContent, type RunLocator, type RunProjection,
  type ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-runtime-profile");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "跑一个任务", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent", pendingDecision: null,
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
    failRun: vi.fn(async () => {}),
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


import type { NativeSessionOwner } from "../../src/application/agent-run/native-session-owner";

it("native checkpoint continuation never falls back when native deployment is unavailable", async () => {
  const run = {...baseRun({checkpointResume:true,resumeStepSeqBase:8}), runtimeProfile:"native-v1" as const};
  const store=fakeStore(run); const complete=vi.fn(async()=>({text:"unexpected legacy replay"}));
  await executeQueuedRuns(deps(store,{complete}),{orgId:ORG});
  expect(complete).not.toHaveBeenCalled();
  expect(store.failRun).toHaveBeenCalledWith(ORG,run.runId,"MODEL_CALL_FAILED","runtime_unavailable");
});

it("legacy approval continuation stays legacy after native rollout is enabled", async () => {
  const run={...baseRun({pendingDecision:{kind:"approve"},resumeStepSeqBase:8}),runtimeProfile:"legacy" as const};
  const store=fakeStore(run); const complete=vi.fn(async(_input:ModelCallInput)=>({text:"continued"}));
  const owner:NativeSessionOwner={provision:vi.fn(async()=>{throw new Error("must not provision");}),resolve:vi.fn(),release:vi.fn(async()=>{}),releaseForRun:vi.fn(async()=>{})};
  await executeQueuedRuns({...deps(store,{complete}),nativeSessions:owner},{orgId:ORG});
  expect(owner.provision).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0]?.[0]).not.toHaveProperty("nativeSession");
  expect(store.failRun).not.toHaveBeenCalled();
});

it("disabled admission keeps a first claim legacy even with a draining native owner", async () => {
  const store=fakeStore({...baseRun({leaseEpoch:1}),runtimeProfile:"legacy"});
  const complete=vi.fn(async(_input:ModelCallInput)=>({text:"legacy new run"}));
  const owner:NativeSessionOwner={provision:vi.fn(async()=>{throw new Error("must not provision");}),resolve:vi.fn(),release:vi.fn(async()=>{}),releaseForRun:vi.fn(async()=>{})};
  await executeQueuedRuns({...deps(store,{complete}),nativeSessions:owner,nativeRuntimeEnabled:false},{orgId:ORG});
  expect(complete).toHaveBeenCalledTimes(1);expect(owner.provision).not.toHaveBeenCalled();expect(store.failRun).not.toHaveBeenCalled();
});
