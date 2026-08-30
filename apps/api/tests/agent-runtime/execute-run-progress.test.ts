/**
 * #742 -- the `completeWithProgress` branch in `execute-run.ts`'s `executeClaimed`.
 *
 * Same philosophy as the (now-retired) `tool-calling-loop.test.ts` had for #725:
 * `execute-run.ts` is pure application code over `ExecuteAgentRunDeps`'s ports, so a fully
 * in-memory fake `AgentRunStore`/`ModelCallPort` is the right level to prove "a provider
 * that reports progress events gets each one recorded as a real `tool_call` step, in
 * order, before the final answer" -- none of which is a SQL/RLS behaviour.
 *
 * ⚠ This proves the PLUMBING (`execute-run.ts` ↔ `ModelCallPort.completeWithProgress`),
 * against a FAKE provider -- it does not and cannot prove that a real `DeepAgentModelProvider`
 * (issue #740/#747, not yet landed) maps a real `deepagents` run's actual state into
 * `ModelCallProgressEvent` correctly. See `ModelCallProgressEvent`'s own doc comment in
 * `ports.ts` and issue #742's comment thread for that unverified half.
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun,
  ModelCallInput, ModelCallPort, ModelCallProgressEvent, PinnedSkillContent, RunDelta,
  RunFailureCode, RunLocator, RunProjection, ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import { ModelCallError } from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-i742-progress");

const SKILL: PinnedSkillContent = {
  versionId: "skill-version-1", content: "# 画一张流程图", stableName: "diagram-maker", name: "画图技能",
};

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "帮我画一张架构图", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "你是通用助手", skillVersionIds: [SKILL.versionId],
    modelProvider: "deep-agent-fake", modelId: "deep-agent", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(
  run: ClaimedAgentRun,
  pinnedSkills: readonly PinnedSkillContent[] = [SKILL],
): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly output: { text: string; finalStepSeq: number } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    output: null as { text: string; finalStepSeq: number } | null,
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
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => pinnedSkills,
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async (_orgId, _delta: AppendedRunDelta) => {
      throw new Error("no delta append expected on the completeWithProgress path");
    },
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async (
      _orgId, _runId, output: { text: string; finalStepSeq: number },
    ) => { state.output = output; },
    failRun: async (_orgId, _runId, code: RunFailureCode) => { state.failedWith = code; },
    async markAwaitingApproval() { throw new Error('unexpected markAwaitingApproval in this test'); },
    async approveAndRequeue() { throw new Error('unexpected approveAndRequeue in this test'); return false; },
    async editAndRequeue() { throw new Error('unexpected editAndRequeue in this test'); return false; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    findAwaitingApprovalRunId: async (): Promise<string | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
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

/** A fake provider that reports a fixed sequence of progress events, then the final text. */
function progressProvider(
  events: readonly ModelCallProgressEvent[],
  finalText: string,
): ModelCallPort & { readonly seenInputs: ModelCallInput[] } {
  const seenInputs: ModelCallInput[] = [];
  return {
    seenInputs,
    complete: async () => { throw new Error("complete() not expected when completeWithProgress exists"); },
    completeWithProgress: async (input, onProgress) => {
      seenInputs.push(input);
      for (const event of events) await onProgress(event);
      return { text: finalText };
    },
  };
}

describe("#742 executeClaimed: completeWithProgress branch", () => {
  it("records each progress event as a real tool_call step, in order, before the terminal model_called step", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const events: ModelCallProgressEvent[] = [
      { toolName: "list_org_skills", toolArgsSummary: null, toolResultSummary: "- diagram-maker：画图技能", planningNote: null },
      {
        toolName: "call_skill", toolArgsSummary: '{"skill_stable_name":"diagram-maker","task":"画一张架构图"}',
        toolResultSummary: "已生成流程图：...", planningNote: "我需要调用画图技能来完成这个任务",
      },
    ];
    const model = progressProvider(events, "已经帮你画好架构图了。");

    const executed = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(executed).toBe(1);
    expect(store.failedWith).toBeNull();
    expect(store.output).toEqual({ text: "已经帮你画好架构图了。", finalStepSeq: 5, files: [] });

    // step seq 0/1 are the run's own acceptance steps (not appended by this file); seq 2 is
    // context_built (appended by executeClaimed itself, not asserted here); seq 3/4 are the
    // two tool_call steps this test cares about; seq 5 is the terminal model_called step.
    const toolCallSteps = store.steps.filter((s) => s.kind === "tool_call");
    expect(toolCallSteps).toHaveLength(2);
    expect(toolCallSteps[0]).toMatchObject({
      seq: 3, status: "succeeded", toolName: "list_org_skills",
      toolArgsSummary: null, toolResultSummary: "- diagram-maker：画图技能", planningNote: null,
    });
    expect(toolCallSteps[1]).toMatchObject({
      seq: 4, status: "succeeded", toolName: "call_skill",
      toolResultSummary: "已生成流程图：...", planningNote: "我需要调用画图技能来完成这个任务",
    });

    const modelCalledStep = store.steps.find((s) => s.kind === "model_called");
    expect(modelCalledStep).toMatchObject({ seq: 5, status: "succeeded" });
  });

  it("zero progress events is a valid run -- the final answer alone is enough", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model = progressProvider([], "不需要调用任何技能，直接回答。");

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.failedWith).toBeNull();
    expect(store.steps.filter((s) => s.kind === "tool_call")).toHaveLength(0);
    expect(store.output).toEqual({ text: "不需要调用任何技能，直接回答。", finalStepSeq: 3, files: [] });
  });

  it("empty final text is a failure, not a fabricated empty reply -- even with progress events recorded", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model = progressProvider(
      [{ toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: "结果", planningNote: null }],
      "   ", // whitespace-only -- same discipline as the plain-call branch's empty-content check
    );

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    // The progress event it DID manage to report before failing stays recorded -- a failed
    // run's steps are not retroactively erased, same discipline the retired TS tool loop had.
    expect(store.steps.filter((s) => s.kind === "tool_call")).toHaveLength(1);
    expect(store.output).toBeNull();
  });

  it("a provider error mid-stream of progress events fails the run with that error's code", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("not expected"); },
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: "部分结果", planningNote: null });
        throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run ended with status \"error\"");
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    expect(store.steps.filter((s) => s.kind === "tool_call")).toHaveLength(1);
    expect(store.output).toBeNull();
  });

  it("completeWithProgress takes priority over completeStream when a provider (hypothetically) had both", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    let streamCalled = false;
    const model: ModelCallPort = {
      complete: async () => { throw new Error("not expected"); },
      completeStream: async () => { streamCalled = true; return { text: "should not be used" }; },
      completeWithProgress: async (_input, onProgress) => {
        await onProgress({ toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: "r", planningNote: null });
        return { text: "progress path used" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(streamCalled).toBe(false);
    expect(store.output?.text).toBe("progress path used");
  });
});
