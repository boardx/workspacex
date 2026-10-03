/**
 * F159 —— 计量写入点的三条主张：
 *
 * ① 一次成功的模型调用 ⇒ 恰好一条用量事件，token 数就是 provider 报的那个数；
 * ② 一次失败的模型调用 ⇒ **也有**一条；上游在错误体里报了 usage 就如实记，没报才是 0
 *    （coord-main 2026-08-12 裁决②的修正：部分 4xx 照样计费 prompt tokens）；
 * ③ **产品里只有一个写入点**——`INSERT INTO token_usage_events` 的字面量在
 *    `apps/api/src` 全部源码里只出现在 `pg-token-usage-repository.ts` 一个文件里。
 *
 * ③ 是本文件里唯一一条**反证**：①② 那种「调一次记一行」的断言，在有第二个写入点
 * 偷偷多记一行时**照样全绿**——它们只看得到自己那条路径。而配额、用量监控、限额事件
 * 三块都从这条流水派生，两个写入点就是两个「这次算多少 token」的答案，且两个都会
 * 各自显示在界面上。所以那条源码扫描不是补充，是这个 feature 的主张本身。
 *
 * 用内存 fake 而不是真实 Postgres，理由与 `execute-run-streaming.test.ts` 头注相同：
 * 这里验证的是端口调用的时序与参数。落库行为（append-only / RLS / CHECK）
 * 由 `token-usage-append-only.test.ts` 在真实 Postgres 上验。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { meterModelCompletion } from "../../src/application/agent-run/meter-model-completion";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { ModelCallError } from "../../src/application/agent-run/ports";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator, RunProjection,
  ThreadHistoryMessage, TokenUsageMeterPort, TokenUsageRecord,
} from "../../src/application/agent-run/ports";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-f159-meter");

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: "proj-1", inputMessageId: "msg-1",
    requesterUserId: "user-linke", inputText: "hello", inputAttachments: [], agentId: "agent-1",
    agentVersionId: "agent-version-1", instructions: "be helpful", skillVersionIds: [],
    modelProvider: "test-provider", modelId: "test-model", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun): AgentRunStore & { readonly failedWith: RunFailureCode | null } {
  const state = { failedWith: null as RunFailureCode | null };
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected to be called by this test`);
  };
  return {
    get failedWith() { return state.failedWith; },
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    reclaimStaleRunning: unused("reclaimStaleRunning"),
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_orgId, _step: AppendedRunStep) => {},
    appendModelDelta: async (_orgId, _delta: AppendedRunDelta) => {},
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async () => {},
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

function recordingMeter(): TokenUsageMeterPort & { readonly written: TokenUsageRecord[] } {
  const written: TokenUsageRecord[] = [];
  return {
    get written() { return written; },
    record: async (_orgId, usage) => { written.push(usage); },
  };
}

function deps(
  runs: AgentRunStore, model: ModelCallPort, usage?: TokenUsageMeterPort,
): ExecuteAgentRunDeps & { readonly log: ReturnType<typeof vi.fn> } {
  let clock = 0;
  const log = vi.fn();
  return {
    runs, model, usage, log,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
  };
}

describe("F159 token 计量：模型调用是唯一产生用量事实的地方", () => {
  it("成功的调用 ⇒ 恰好一行，token 数 = provider 报的数，归属到触发它的那个人", async () => {
    const meter = recordingMeter();
    const model: ModelCallPort = { complete: async () => ({ text: "reply", tokens: 1234 }) };

    await executeQueuedRuns(deps(fakeStore(baseRun()), model, meter), { orgId: ORG });

    expect(meter.written).toEqual([expect.objectContaining({
      userId: "user-linke", runId: "run-1",
      modelProvider: "test-provider", modelId: "test-model",
      tokensTotal: 1234, promptTokens: null, completionTokens: null, outcome: "succeeded",
    })]);
  });

  it("上游报了 prompt/completion 拆分就如实记（OpenAI 兼容 usage 本来就带这两个字段）", async () => {
    const meter = recordingMeter();
    const model: ModelCallPort = {
      complete: async () => ({ text: "reply", tokens: 300, promptTokens: 200, completionTokens: 100 }),
    };

    await executeQueuedRuns(deps(fakeStore(baseRun()), model, meter), { orgId: ORG });

    expect(meter.written[0]).toMatchObject({
      tokensTotal: 300, promptTokens: 200, completionTokens: 100,
    });
  });

  it("上游只报总数 ⇒ 拆分维度记 null（不是 0）——「没报」与「用了 0」是两件事", async () => {
    const meter = recordingMeter();
    const model: ModelCallPort = { complete: async () => ({ text: "reply", tokens: 300 }) };

    await executeQueuedRuns(deps(fakeStore(baseRun()), model, meter), { orgId: ORG });

    expect(meter.written[0]).toMatchObject({
      tokensTotal: 300, promptTokens: null, completionTokens: null,
    });
  });

  it("失败的调用：上游在错误体里报了 usage 就如实记，不硬编 0", async () => {
    const meter = recordingMeter();
    const model: ModelCallPort = {
      complete: async () => {
        // provider 从 4xx 响应体里解出的 usage 挂在错误上（只带数字，不带错误文本）。
        throw new ModelCallError("MODEL_CALL_FAILED", "upstream 429", { total: 120, prompt: 120, completion: 0 });
      },
    };

    await executeQueuedRuns(deps(fakeStore(baseRun()), model, meter), { orgId: ORG });

    expect(meter.written[0]).toMatchObject({
      tokensTotal: 120, promptTokens: 120, completionTokens: 0, outcome: "failed",
    });
  });

  it("provider 没报 token 数 ⇒ 记 0，不估值（估出来的数会被当成账）", async () => {
    const meter = recordingMeter();
    const model: ModelCallPort = { complete: async () => ({ text: "reply with no usage header" }) };

    await executeQueuedRuns(deps(fakeStore(baseRun()), model, meter), { orgId: ORG });

    expect(meter.written).toHaveLength(1);
    expect(meter.written[0]).toMatchObject({ tokensTotal: 0, totalSource: "unknown", outcome: "succeeded" });
  });

  it("失败的调用 ⇒ 也有一行（failed / 0）——「失败就没有用量」会让流水与 run 行数对不上", async () => {
    const meter = recordingMeter();
    const store = fakeStore(baseRun());
    const model: ModelCallPort = {
      complete: async () => { throw new ModelCallError("MODEL_CALL_FAILED", "upstream 503"); },
    };

    await executeQueuedRuns(deps(store, model, meter), { orgId: ORG });

    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    expect(meter.written).toEqual([expect.objectContaining({
      userId: "user-linke", runId: "run-1",
      modelProvider: "test-provider", modelId: "test-model",
      tokensTotal: 0, promptTokens: null, completionTokens: null, outcome: "failed",
    })]);
  });

  it("计量写失败不拖垮这次 run，但**大声留痕**（静默吞才是那个会骗人的错法）", async () => {
    const store = fakeStore(baseRun());
    const model: ModelCallPort = { complete: async () => ({ text: "reply", tokens: 7 }) };
    const brokenMeter: TokenUsageMeterPort = {
      record: async () => { throw new Error("db down"); },
    };
    const d = deps(store, model, brokenMeter);

    const n = await executeQueuedRuns(d, { orgId: ORG });

    expect(n).toBe(1);
    expect(store.failedWith).toBeNull();          // 记账缺陷不该变成用户的聊天失败
    expect(d.log).toHaveBeenCalledWith(
      expect.stringContaining("token usage metering write failed"),
      expect.objectContaining({ runId: "run-1", tokensTotal: 7 }),
    );
  });

  it("【反证】INSERT INTO token_usage_events 在 apps/api/src 里只出现在一个文件", () => {
    const root = join(__dirname, "../../src");
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        // 空白不敏感：`INSERT INTO\n  token_usage_events` 也算命中，否则换个换行就绕过了。
        if (/INSERT\s+INTO\s+token_usage_events/i.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(root);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/pg-token-usage-repository\.ts$/);
  });

  it("【反证】计量仓储是 INSERT-only —— 它在 lint-permission-paths 允许清单里的条件就是这个", () => {
    // `lint-permission-paths.mjs` 放行这个文件不走 `guard()`/`disclose()`，理由是
    // 「它根本没有读方法，只有一条 INSERT」。写在允许清单里的理由是一句无人验证的话；
    // 这条断言让它变成会红的东西：任何 SELECT/UPDATE/DELETE 出现在这个仓储里都当场失败。
    const src = readFileSync(
      join(__dirname, "../../src/infrastructure/auth/pg-token-usage-repository.ts"), "utf8",
    );
    const statements = src.match(/\b(SELECT|UPDATE|DELETE)\b/gi) ?? [];
    expect(statements).toEqual([]);
  });
});


describe("ledger receipt execution boundaries", () => {
  it("records trusted attribution and distinguishes a reported zero", async () => {
    const usage = recordingMeter();
    await executeQueuedRuns(deps(fakeStore(baseRun()), { complete: async () => ({ text: "reply", tokens: 0 }) }, usage), { orgId: ORG });
    expect(usage.written[0]).toMatchObject({
      eventId: expect.any(String), totalSource: "reported", tokensTotal: 0,
      projectId: "proj-1", threadId: "thread-1", agentId: "agent-1", callPurpose: "primary",
    });
  });
  it("records a cancelled provider envelope before checkpoint return", async () => {
    const usage = recordingMeter();
    let invoked = false;
    const store = { ...fakeStore(baseRun()), cancelAtCheckpoint: async () => invoked };
    const model: ModelCallPort = { complete: async () => { invoked = true; return { text: "", tokens: 17, cancelled: true }; } };
    await executeQueuedRuns(deps(store, model, usage), { orgId: ORG });
    expect(usage.written).toHaveLength(1);
    expect(usage.written[0]).toMatchObject({ tokensTotal: 17, totalSource: "reported", outcome: "failed" });
  });
  it("retains usage when successful provider output is empty", async () => {
    const usage = recordingMeter();
    await executeQueuedRuns(deps(fakeStore(baseRun()), { complete: async () => ({ text: "", tokens: 19 }) }, usage), { orgId: ORG });
    expect(usage.written).toHaveLength(1);
    expect(usage.written[0]).toMatchObject({ tokensTotal: 19, outcome: "failed" });
  });
  it("does not double count when downstream audit persistence fails after completion", async () => {
    const usage = recordingMeter();
    const store = fakeStore(baseRun());
    const append = store.appendStep;
    store.appendStep = async (orgId, step) => {
      if (step.kind === "model_called" && step.outputDigest !== null) throw new Error("audit unavailable");
      return append(orgId, step);
    };
    expect(await executeQueuedRuns(deps(store, { complete: async () => ({ text: "reply", tokens: 23 }) }, usage), { orgId: ORG })).toBe(1);
    expect(store.failedWith).toBe("MODEL_CALL_FAILED");
    expect(usage.written).toHaveLength(1);
    expect(usage.written[0]?.tokensTotal).toBe(23);
  });
});


describe("auxiliary model call receipts", () => {
  it("counts summary and script retries independently under the same user/org", async () => {
    const usage = recordingMeter();
    const d = deps(fakeStore(baseRun()), { complete: async () => ({ text: "reply" }) }, usage);
    for (const purpose of ["history-summary", "script-retry"] as const) {
      await meterModelCompletion(d, ORG, baseRun(), purpose, async () => ({ text: "result", tokens: 31 }));
    }
    expect(usage.written.map(r => r.callPurpose)).toEqual(["history-summary", "script-retry"]);
    expect(new Set(usage.written.map(r => r.eventId)).size).toBe(2);
    expect(usage.written.reduce((sum, r) => sum + r.tokensTotal, 0)).toBe(62);
  });
  it("counts failed auxiliary requests with provider usage and rethrows the original error", async () => {
    const usage = recordingMeter();
    const d = deps(fakeStore(baseRun()), { complete: async () => ({ text: "reply" }) }, usage);
    const error = new ModelCallError("MODEL_CALL_FAILED", "failure", { total: 11 });
    await expect(meterModelCompletion(d, ORG, baseRun(), "script-retry", async () => { throw error; })).rejects.toBe(error);
    expect(usage.written[0]).toMatchObject({ tokensTotal: 11, outcome: "failed", callPurpose: "script-retry" });
  });
  it("meters a paused envelope without declaring it a failed call", async () => {
    const usage = recordingMeter();
    const store = { ...fakeStore(baseRun()), pauseAtCheckpoint: async () => "paused" as const };
    await executeQueuedRuns(deps(store, { complete: async () => ({ text: "", tokens: 7, paused: true }) }, usage), { orgId: ORG });
    expect(usage.written).toHaveLength(1);
    expect(usage.written[0]).toMatchObject({ tokensTotal: 7, outcome: "succeeded" });
  });
});


describe("execution preparation and actual history summary integration", () => {
  it("does not create a usage receipt when dispatch capability validation fails before invocation", async () => {
    const usage = recordingMeter();
    const complete = vi.fn(async () => ({ text: "reply", tokens: 5 }));
    const model: ModelCallPort = {
      complete, completeWithProgress: complete,
      supportsProgress: () => { throw new Error("dispatch unavailable"); },
    };
    await executeQueuedRuns(deps(fakeStore(baseRun()), model, usage), { orgId: ORG });
    expect(complete).not.toHaveBeenCalled();
    expect(usage.written).toHaveLength(0);
  });
  it("meters history compaction separately from the primary model envelope", async () => {
    const usage = recordingMeter();
    const store = fakeStore(baseRun());
    store.readThreadHistory = async () => Array.from({ length: 20 }, (_, i) => ({
      id: `history-${i}`, role: "user" as const, content: "history ".repeat(2000),
    }));
    const complete = vi.fn(async () => ({ text: "summary or reply", tokens: 13 }));
    await executeQueuedRuns(deps(store, { complete }, usage), { orgId: ORG });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(usage.written.map(r => r.callPurpose)).toEqual(["history-summary", "primary"]);
    expect(new Set(usage.written.map(r => r.eventId)).size).toBe(2);
  });
});
