import { toOrgId } from "/home/user/workspacex/apps/api/src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "/home/user/workspacex/apps/api/src/application/agent-run/execute-run";
import { createInMemoryToolPermissionGrantStore } from "/home/user/workspacex/apps/api/src/application/agent-run/tool-permission-grants";
import { createInMemoryInterjectionStore } from "/home/user/workspacex/apps/api/src/application/agent-run/interjection-store";
import { classifyInterjection } from "/home/user/workspacex/apps/api/src/application/agent-run/interjection-handling";
import {
  DEEP_AGENT_PROVIDER_NAME,
  type AgentRunStore, type AppendedRunStep, type ClaimedAgentRun, type ClaimOutcome,
  type ModelCallPort, type PinnedSkillContent, type RunLocator, type RunProjection,
  type ThreadHistoryMessage,
} from "/home/user/workspacex/apps/api/src/application/agent-run/ports";
import type { Guarded } from "/home/user/workspacex/apps/api/src/application/security/permission-filter";

const ORG = toOrgId("org-f11-manual-check");
let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) { failures += 1; console.error("FAIL:", msg); } else { console.log("ok:", msg); }
}

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "跑一个任务", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [],
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "deep-agent", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun) {
  const state = { steps: [] as AppendedRunStep[], markAwaitingCalls: 0, approveCalls: 0 };
  const unused = (name: string) => async (): Promise<never> => { throw new Error(`unused ${name}`); };
  const store: AgentRunStore & { steps: AppendedRunStep[]; markAwaitingCalls: number; approveCalls: number } = {
    get steps() { return state.steps; },
    get markAwaitingCalls() { return state.markAwaitingCalls; },
    get approveCalls() { return state.approveCalls; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async () => {},
    readModelDeltas: async () => [],
    storeOutputAwaitingWriteback: async () => {},
    failRun: async () => { throw new Error("unexpected failRun"); },
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
  return store;
}

function deps(runs: AgentRunStore, model: ModelCallPort, extra: Pick<ExecuteAgentRunDeps, "toolPermissionGrants" | "interjections"> = {}): ExecuteAgentRunDeps {
  let clock = 0;
  return { runs, model, ...extra, clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` }, log: () => {} };
}

async function main() {
  // classifyInterjection
  assert(classifyInterjection("把第二页标题改成蓝色") === "adjustment", "adjustment classification");
  assert(classifyInterjection("算了，换个方向做别的") === "direction_change", "direction_change classification");

  // I-5 / R12: not interrupted mid-call, shows up in next step
  {
    const run = baseRun();
    const store = fakeStore(run);
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, { interjectionId: "itj-1", text: "把第二页标题改成 X", receivedAt: "2026-09-05T00:00:00.000Z" });
    let interjectionSeenWhileInProgress = false;
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: null, planningNote: null, phase: "in_progress", toolCallId: "call-1" });
        interjectionSeenWhileInProgress = store.steps.some((s) => s.planningNote?.includes("把第二页标题改成 X"));
        await onProgress({ toolName: "read_file", toolArgsSummary: "{}", toolResultSummary: "文件内容", planningNote: null, phase: "complete", toolCallId: "call-1" });
        await onProgress({ toolName: "grep", toolArgsSummary: "{}", toolResultSummary: "命中 3 处", planningNote: null });
        return { text: "读完了。" };
      },
    };
    await executeQueuedRuns(deps(store, model, { interjections }), { orgId: ORG });
    assert(interjectionSeenWhileInProgress === false, "no interjection step recorded while a tool call is still in_progress");
    const toolSteps = store.steps.filter((s) => s.kind === "tool_call");
    const interjectionSteps = store.steps.filter((s) => s.kind === "model_called" && s.planningNote?.includes("把第二页标题改成 X"));
    assert(interjectionSteps.length === 1, "exactly one interjection step recorded");
    const readFileTerminalSeq = toolSteps.find((s) => s.toolName === "read_file" && s.status === "succeeded")!.seq;
    const grepSeq = toolSteps.find((s) => s.toolName === "grep")!.seq;
    assert(interjectionSteps[0]!.seq > readFileTerminalSeq && interjectionSteps[0]!.seq < grepSeq, "interjection step sits strictly between the two tool_call steps");
  }

  // no interjections configured: no regression
  {
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
    await executeQueuedRuns(deps(store, model), { orgId: ORG });
    assert(!store.steps.some((s) => s.kind === "model_called" && s.planningNote?.includes("已插话")), "no interjection side effects when port not configured");
  }

  // E3: direction_change revokes run-scoped grant, forcing re-authorization
  {
    const run = baseRun();
    const store = fakeStore(run);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, { interjectionId: "itj-2", text: "算了，换个方向，直接生成 PPT", receivedAt: "2026-09-05T00:00:00.000Z" });
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({ text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" } }),
    };
    await executeQueuedRuns(deps(store, model, { toolPermissionGrants: grants, interjections }), { orgId: ORG });
    assert(store.markAwaitingCalls === 1, "direction_change forces awaiting_tool_permission");
    assert(store.approveCalls === 0, "direction_change: no auto-approve");
    assert((await grants.hasGrant(ORG, run.runId, "call_skill")) === false, "run-scoped grant revoked");
    const interjectionStep = store.steps.find((s) => s.planningNote?.includes("换个方向"));
    const awaitingStep = store.steps.find((s) => s.planningNote?.includes("等待人工批准"));
    assert(!!interjectionStep && !!awaitingStep && interjectionStep.seq < awaitingStep.seq, "interjection consumed before the authorization check");
  }

  // contrast: adjustment does not revoke
  {
    const run = baseRun();
    const store = fakeStore(run);
    const grants = createInMemoryToolPermissionGrantStore();
    await grants.grantForRun(ORG, run.runId, "call_skill");
    const interjections = createInMemoryInterjectionStore();
    await interjections.submit(ORG, run.runId, { interjectionId: "itj-3", text: "字体再小一号", receivedAt: "2026-09-05T00:00:00.000Z" });
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      checkKernelHealth: async () => "healthy",
      completeWithProgress: async () => ({ text: "", interrupted: { toolName: "call_skill", argsSummary: "{}" } }),
    };
    await executeQueuedRuns(deps(store, model, { toolPermissionGrants: grants, interjections }), { orgId: ORG });
    assert(store.approveCalls === 1, "adjustment: still auto-approved");
    assert(store.markAwaitingCalls === 0, "adjustment: no awaiting_tool_permission");
    assert((await grants.hasGrant(ORG, run.runId, "call_skill")) === true, "adjustment: grant untouched");
  }

  console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
