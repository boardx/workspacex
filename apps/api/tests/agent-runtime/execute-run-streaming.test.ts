/**
 * #654 阶段2a — `executeQueuedRuns`/`executeClaimed` 的流式分支。
 *
 * 这是本仓库里少数用纯内存 fake 而不是真实 Postgres 的用例：`execute-run.ts` 本身是
 * 纯函数式的应用层代码，唯一的外部依赖就是 `ExecuteAgentRunDeps` 这四个端口
 * （`AgentRunStore`/`ModelCallPort`/`clock`/`log`），而这里要验证的行为——「有
 * `completeStream` 就走它、没有就退回 `complete()`、每个增量按 seq 顺序落盘、
 * 空文本仍然判失败」——是端口调用的时序/参数，不是任何 SQL 或 RLS 行为
 * （那部分已经在 `agent-run-deltas-store.test.ts` 用真实 Postgres 测过）。用真实
 * 数据库重复这套时序断言只会把同一件事测两遍、跑得更慢。
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, ModelCallInput,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator, RunProjection,
  ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-i654-exec");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "hello", inputAttachments: [], agentId: "agent-1", agentVersionId: "agent-version-1",
    instructions: "be helpful", skillVersionIds: [], modelProvider: "test-provider",
    modelId: "test-model", pendingDecision: null,
    ...overrides,
  };
}

/** A fake `AgentRunStore` that records what was called, and throws for anything unused here. */
function fakeStore(run: ClaimedAgentRun): AgentRunStore & {
  readonly steps: AppendedRunStep[];
  readonly deltas: AppendedRunDelta[];
  readonly output: { text: string } | null;
  readonly failedWith: RunFailureCode | null;
} {
  const state = {
    steps: [] as AppendedRunStep[],
    deltas: [] as AppendedRunDelta[],
    output: null as { text: string } | null,
    failedWith: null as RunFailureCode | null,
  };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    // Getters, not a value spread: `state`'s fields are reassigned/mutated by the closures
    // below AFTER this object is constructed, and a plain `...state` spread would have
    // frozen `output`/`failedWith` at their initial `null` forever.
    get steps() { return state.steps; },
    get deltas() { return state.deltas; },
    get output() { return state.output; },
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, step: AppendedRunStep) => { state.steps.push(step); },
    appendModelDelta: async (_orgId, delta: AppendedRunDelta) => { state.deltas.push(delta); },
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async (_orgId, _runId, output: { text: string }) => {
      state.output = { text: output.text };
    },
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
    // #690: no thread history fixtures in this file -- these tests are about the
    // streaming/delta timing, not about what gets read from a thread.
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

describe("executeQueuedRuns — streaming branch (#654 阶段2a)", () => {
  it("completeStream 存在时：逐个增量按 seq=0,1,2… 落盘，最终文本是全部增量的拼接", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const seenDeltas: string[] = [];
    const model: ModelCallPort = {
      complete: async () => { throw new Error("complete() must not be called when completeStream exists"); },
      completeStream: async (_input: ModelCallInput, onDelta) => {
        for (const fragment of ["Hel", "lo, ", "world"]) {
          seenDeltas.push(fragment);
          await onDelta(fragment);
        }
        return { text: "Hello, world", tokens: 3 };
      },
    };

    const n = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(n).toBe(1);
    expect(seenDeltas).toEqual(["Hel", "lo, ", "world"]);
    expect(store.deltas.map((d) => ({ seq: d.seq, text: d.text }))).toEqual([
      { seq: 0, text: "Hel" },
      { seq: 1, text: "lo, " },
      { seq: 2, text: "world" },
    ]);
    expect(store.output).toEqual({ text: "Hello, world" });
    expect(store.failedWith).toBeNull();
  });

  it("completeStream 不存在时：退回 complete()，不落任何增量，行为与阶段2a之前完全一致", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => ({ text: "one-shot reply", tokens: 5 }),
      // No completeStream — mirrors DeepResearchModelProvider / BailianImageProvider today.
    };

    const n = await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(n).toBe(1);
    expect(store.deltas).toEqual([]);
    expect(store.output).toEqual({ text: "one-shot reply" });
  });

  it("流式路径下累计文本为空仍然判失败——空回复不因为'走过增量'就被放行", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      completeStream: async () => ({ text: "" }),
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.output).toBeNull();
    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
  });

  it("空字符串增量被跳过，不占用 seq、不落盘", async () => {
    const run = baseRun();
    const store = fakeStore(run);
    const model: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      completeStream: async (_input, onDelta) => {
        await onDelta("a");
        await onDelta(""); // e.g. a provider keep-alive fragment with no content
        await onDelta("b");
        return { text: "ab" };
      },
    };

    await executeQueuedRuns(deps(store, model), { orgId: ORG });

    expect(store.deltas.map((d) => ({ seq: d.seq, text: d.text }))).toEqual([
      { seq: 0, text: "a" },
      { seq: 1, text: "b" },
    ]);
  });
});
