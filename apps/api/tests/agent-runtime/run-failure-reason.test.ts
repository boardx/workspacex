/**
 * issue #3211 ① —— 「这次 run 为什么失败」必须能从产品面分辨出来。
 *
 * ## 反证的形状
 *
 * 人类 2026-09-09 在 devapp 实测：一句「总结这个网页」跑了 8 分钟、6 次工具调用，
 * 整轮失败零产出，界面只说「模型这次没能返回可用结果」。取证判定的结论是：
 * **这不是「以前修过的那句话又回退了」**。`execute-run.ts` 的 catch（#3033）确实算出了
 * 带真实异常的 `detail`，但那段代码自己的注释逐字写着 `detail` never reaches a response
 * —— detail 只进日志，产品面永远只有一个枚举码 `MODEL_CALL_FAILED`。
 *
 * 于是至少四件事在界面上**完全同形**：
 *   ① 模型返回空；② 远端 deep-agent run 自己报错；③ 远端超时；
 *   ④ **我们自己的执行器抛异常**（`execute-run.ts` 的 "agent run executor defect" 分支）。
 *
 * 下面每条用例都钉住一对「必须能分辨」的关系。把 `failRun` 的第四个参数删掉、或把
 * 分类器改成恒返回 `unknown`，这些断言立刻红。
 */
import { describe, expect, it, vi } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { classifyModelCallFailureReason } from "../../src/domain/agent-run/model-call-failure-reason";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunFailureReason,
  RunLocator, RunProjection, ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import { ModelCallError } from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";
import type { ExecutionEventInput } from "@repo/contracts/execution-journal";

const ORG = toOrgId("org-3211-failure-reason");
const SKILL: PinnedSkillContent = {
  versionId: "skill-version-1", content: "# 网页总结", stableName: "web-summary", name: "网页总结",
};

function baseRun(): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1", requesterUserId: "user-1",
    inputText: "总结这个网页：https://example.com/x", inputAttachments: [], agentId: "agent-1",
    agentVersionId: "agent-version-1", instructions: "你是通用助手", skillVersionIds: [SKILL.versionId],
    modelProvider: "deep-agent-fake", modelId: "deep-agent", pendingDecision: null,
  };
}

function fakeStore(run: ClaimedAgentRun): AgentRunStore & {
  readonly failedWith: { code: RunFailureCode; reason: RunFailureReason | undefined } | null;
} {
  const state = { failed: null as { code: RunFailureCode; reason: RunFailureReason | undefined } | null };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get failedWith() { return state.failed; },
    appendExecutionEvent: async (_orgId, _runId, _event: ExecutionEventInput) => {},
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [SKILL],
    appendStep: async (_orgId, _step: AppendedRunStep) => {},
    appendModelDelta: async (_orgId, _delta: AppendedRunDelta) => {},
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: unused("storeOutputAwaitingWriteback"),
    failRun: async (_orgId, _runId, code: RunFailureCode, reason?: RunFailureReason) => {
      state.failed = { code, reason };
    },
    async markAwaitingToolPermission() { throw new Error("unexpected markAwaitingToolPermission"); },
    async approveAndRequeue() { throw new Error("unexpected approveAndRequeue"); return false; },
    async denyAndRequeue() { throw new Error("unexpected denyAndRequeue"); return false; },
    async editAndRequeue() { throw new Error("unexpected editAndRequeue"); return false; },
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

function deps(runs: AgentRunStore, model: ModelCallPort): ExecuteAgentRunDeps {
  let clock = 0;
  return { runs, model, clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` }, log: vi.fn() };
}

const providerThatThrows = (error: unknown): ModelCallPort => ({
  complete: async () => { throw error; },
  completeWithProgress: async () => { throw error; },
});

/** 一次真实执行后，run 被以什么 (code, reason) 收成终态。 */
async function terminalFailure(error: unknown) {
  const store = fakeStore(baseRun());
  await executeQueuedRuns(deps(store, providerThatThrows(error)), { orgId: ORG });
  return store.failedWith;
}

describe("#3211 ① run 失败成因在产品面可分辨", () => {
  it("模型返回空 与 远端 run 报错：同一个 code，不同的 reason", async () => {
    const empty = await terminalFailure(
      new ModelCallError("MODEL_CALL_FAILED", "provider returned neither content nor a progress event"),
    );
    const rejected = await terminalFailure(
      new ModelCallError("MODEL_CALL_FAILED", 'deep agent run ended with status "error"'),
    );
    // 改动前这一对在产品面**完全同形**——这正是这条 issue 报的现象。
    expect(empty?.code).toBe("MODEL_CALL_FAILED");
    expect(rejected?.code).toBe("MODEL_CALL_FAILED");
    expect(empty?.reason).toBe("provider_returned_empty");
    expect(rejected?.reason).toBe("provider_rejected");
    expect(empty?.reason).not.toBe(rejected?.reason);
  });

  it("远端超时 与 传输层失败：不共用同一个 reason", async () => {
    const timedOut = await terminalFailure(
      new ModelCallError("MODEL_CALL_FAILED", "deep agent run did not reach a terminal state within 300000ms"),
    );
    const transport = await terminalFailure(
      new ModelCallError("MODEL_CALL_FAILED", "deep agent run submission failed with HTTP 502"),
    );
    expect(timedOut?.reason).toBe("provider_timeout");
    expect(transport?.reason).toBe("provider_transport_failed");
  });

  /**
   * 最关键的一条：**我们自己的 bug** 不许伪装成「模型没给结果」。
   * `execute-run.ts` 里非 `ModelCallError` 的裸异常走的就是这条路。
   */
  it("裸异常（非 ModelCallError）不被猜成 provider_returned_empty", async () => {
    const defect = await terminalFailure(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(defect?.code).toBe("MODEL_CALL_FAILED");
    expect(defect?.reason).not.toBe("provider_returned_empty");
    expect(defect?.reason).not.toBe("provider_rejected");
    // 认不出来就老实说认不出来——比编一个具体但错误的原因好。
    expect(defect?.reason).toBe("unknown");
  });

  it("分类器认不出的 detail 一律 unknown，绝不猜", () => {
    expect(classifyModelCallFailureReason(null)).toBe("unknown");
    expect(classifyModelCallFailureReason("")).toBe("unknown");
    expect(classifyModelCallFailureReason("某个从没见过的错误")).toBe("unknown");
  });

  it("契约枚举与分类器的取值域一致（分类器不许产出契约外的值）", () => {
    const allowed = new Set<string>(wave2Runtime.AgentRunFailureReason.options);
    for (const detail of [
      "provider returned neither content nor a progress event",
      'deep agent run ended with status "error"',
      "deep agent run did not reach a terminal state within 300000ms",
      "deep agent thread creation failed with HTTP 500",
      "deep agent service transport failure",
      "native_runtime_unavailable_for_continuation",
      "完全认不出来的东西",
    ]) {
      expect(allowed.has(classifyModelCallFailureReason(detail))).toBe(true);
    }
  });
});
