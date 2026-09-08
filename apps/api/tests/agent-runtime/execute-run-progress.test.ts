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
import type { ExecutionEventInput } from "@repo/contracts/execution-journal";

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
  readonly executionEvents: ExecutionEventInput[];
  readonly output: { text: string; finalStepSeq: number } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    executionEvents: [] as ExecutionEventInput[],
    output: null as { text: string; finalStepSeq: number } | null,
    failedWith: null as RunFailureCode | null,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get steps() { return state.steps; },
    get executionEvents() { return state.executionEvents; },
    appendExecutionEvent: async (_orgId, _runId, event: ExecutionEventInput) => {
      state.executionEvents.push(event);
    },
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
    async markAwaitingToolPermission() { throw new Error('unexpected markAwaitingToolPermission in this test'); },
    async approveAndRequeue() { throw new Error('unexpected approveAndRequeue in this test'); return false; },
    async denyAndRequeue() { throw new Error('unexpected denyAndRequeue in this test'); return false; },
    async editAndRequeue() { throw new Error('unexpected editAndRequeue in this test'); return false; },
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

  /**
   * #3063 反证 —— #3058 之后 `stable_name` 是合规 slug（中文展示名 ⇒ `skill-<8 位 hex>`），
   * 线上唯一带身份的字符串再也不能直接给人看。run 侧本来就把这批 skill 读进来了
   * （`readPinnedSkills` 的 `name`），这里证明它把展示名快照进了 `tool_start` 事件。
   * 撤掉 `execute-run.ts` 里的 `skillDisplayNameField(...)` 展开，本用例立刻红。
   */
  it("#3063 call_skill 的 tool_start 事件带上展示名快照（中文名 + skill-xxxxxxxx 身份）", async () => {
    const chineseSkill: PinnedSkillContent = {
      versionId: "skill-version-zh", content: "# 会议纪要", stableName: "skill-9f3a1b7c", name: "会议纪要整理",
    };
    const run = baseRun({ skillVersionIds: [chineseSkill.versionId] });
    const store = fakeStore(run, [chineseSkill]);
    // `tool_start` 执行事件只由 `phase: "in_progress"` 那一帧产生（工具刚被宣布调用），
    // 所以按真实 provider 的两帧节奏来：宣布 → 结果。
    const model = progressProvider([
      {
        toolName: "call_skill", phase: "in_progress", toolCallId: "call-1",
        toolArgsSummary: '{"skill_stable_name":"skill-9f3a1b7c","task":"整理会议纪要"}',
        toolResultSummary: null, planningNote: null,
      },
      {
        toolName: "call_skill", phase: "complete", toolCallId: "call-1",
        toolArgsSummary: '{"skill_stable_name":"skill-9f3a1b7c","task":"整理会议纪要"}',
        toolResultSummary: "已整理", planningNote: null,
      },
      // 非 call_skill 的一跳：绝不能被塞进一个它根本没有的技能名。
      {
        toolName: "read_file", phase: "in_progress", toolCallId: "call-2",
        toolArgsSummary: '{"path":"/a.md"}', toolResultSummary: null, planningNote: null,
      },
    ], "已经帮你整理好会议纪要了。");

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    const starts = store.executionEvents.filter((e) => e.kind === "tool_start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ toolName: "call_skill", skillDisplayName: "会议纪要整理" });
    expect(starts[1]).not.toHaveProperty("skillDisplayName");
  });

  it("#3063 挂的 skill 里找不到这个 stable_name ⇒ 不猜名字，键缺席（展示层退回原样回显）", async () => {
    const run = baseRun();
    const store = fakeStore(run, [SKILL]);
    const model = progressProvider([
      {
        toolName: "call_skill", phase: "in_progress", toolCallId: "call-1",
        toolArgsSummary: '{"skill_stable_name":"skill-deadbeef","task":"x"}',
        toolResultSummary: null, planningNote: null,
      },
    ], "好了。");

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    const start = store.executionEvents.find((e) => e.kind === "tool_start");
    expect(start).toMatchObject({ toolName: "call_skill" });
    expect(start).not.toHaveProperty("skillDisplayName");
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

  it("#3033 a non-ModelCallError from the provider path is logged with its name and message, not swallowed", async () => {
    // PgNativeSessionOwner throws bare `Error('native_session_*')` before the Deep Agent is ever
    // reached; before #3033 the log said only "unexpected model call failure" and production
    // triage had nothing to go on. The response-side invariant is untouched: still the enum code.
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("not expected"); },
      completeWithProgress: async () => { throw new Error("native_session_provision_failed_no_replay"); },
    };
    const d = deps(store, model);

    await executeQueuedRuns(d, { orgId: ORG });

    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    const entry = (d.log as ReturnType<typeof vi.fn>).mock.calls.find(([msg]) => msg === "agent run model call failed");
    expect(entry).toBeDefined();
    expect((entry![1] as { detail: string }).detail).toBe(
      "unexpected model call failure: Error: native_session_provision_failed_no_replay",
    );
    // 反证：ModelCallError 的 detail 仍原样透传，没有被新前缀污染
    const model2: ModelCallPort = {
      complete: async () => { throw new Error("not expected"); },
      completeWithProgress: async () => { throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run ended with status \"error\""); },
    };
    const store2 = fakeStore(baseRun());
    const d2 = deps(store2, model2);
    await executeQueuedRuns(d2, { orgId: ORG });
    const entry2 = (d2.log as ReturnType<typeof vi.fn>).mock.calls.find(([msg]) => msg === "agent run model call failed");
    expect((entry2![1] as { detail: string }).detail).toBe("deep agent run ended with status \"error\"");
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
