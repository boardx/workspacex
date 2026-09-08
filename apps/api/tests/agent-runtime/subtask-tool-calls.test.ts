/**
 * issue #3100 D6 —— 子任务工具明细的三层（契约折叠 / 持久化 / 引擎上报）。
 *
 * 反证纪律（AGENTS.md「写完门控立刻造反证」）：
 *   · 撤掉 `foldSubtaskToolCall` 的"首次时刻恒为 startedAt"→ 第 2 例红；
 *   · 撤掉 `InMemorySubtaskRunStore.recordToolCall` → 第 4 例红；
 *   · 把 `SubtaskRunExecutor` 改回只调 `complete()` → 第 5 例红（工具明细恒为空）。
 */
import { describe, expect, it, vi } from "vitest";
import { foldSubtaskToolCall, type SubtaskToolCall } from "../../src/application/agent-run/subtask-run-queue";
import { InMemorySubtaskRunStore } from "../../src/infrastructure/agent-run/in-memory-subtask-run-store";
import { SubtaskRunExecutor } from "../../src/infrastructure/agent-run/subtask-run-executor";
import { toOrgId } from "../../src/domain/org-id";
import { subtaskRun as SubtaskRunContract } from "@repo/contracts";
import { ToolCallStartFields, ToolCallEndFields } from "@repo/contracts/execution-journal";

const org = toOrgId("org-3100");
const observation = (over: Partial<Parameters<typeof foldSubtaskToolCall>[1]> = {}) => ({
  toolCallId: "call-1", toolName: "web_search", argsSummary: "q", resultSummary: null,
  phase: "in_progress" as const, ok: null as boolean | null, at: "2026-09-08T10:00:00.000Z", ...over,
});

describe("契约 SubtaskRun.toolCalls —— 与父 run 账本同源、多余字段拒收", () => {
  it("承载工具明细并拒绝未声明字段（strict）", () => {
    const call = { toolCallId: "c1", toolName: "web_search", argsSummary: null, resultSummary: null,
      ok: null, startedAt: "2026-09-08T10:00:00.000Z", durationMs: null };
    expect(SubtaskRunContract.SubtaskToolCall.parse(call)).toEqual(call);
    expect(SubtaskRunContract.SubtaskToolCall.safeParse({ ...call, invented: 1 }).success).toBe(false);
    const run = { id: "s1", parentRunId: "p1", description: "d", context: null,
      snapshot: { agentVersionId: "v", skillVersionIds: [], modelProvider: "m", modelId: "i" },
      artifactRefs: [], toolCalls: [call], status: "running", result: null, error: null,
      createdAt: "2026-09-08T10:00:00.000Z", updatedAt: "2026-09-08T10:00:00.000Z" };
    expect(SubtaskRunContract.SubtaskRun.parse(run).toolCalls).toEqual([call]);
    // 缺席合法（旧行 / 不上报的部署），与空数组同义：引擎没上报。
    const { toolCalls: _omitted, ...without } = run;
    expect(SubtaskRunContract.SubtaskRun.parse(without).toolCalls).toBeUndefined();
  });

  it("字段定义取自父 run 账本，不是照抄的第二套", () => {
    expect(SubtaskRunContract.SubtaskToolCall.shape.toolCallId).toBe(ToolCallStartFields.toolCallId);
    expect(SubtaskRunContract.SubtaskToolCall.shape.toolName).toBe(ToolCallStartFields.toolName);
    expect(SubtaskRunContract.SubtaskToolCall.shape.ok.unwrap()).toBe(ToolCallEndFields.ok);
  });
});

describe("foldSubtaskToolCall —— 与父 run 账本同一批字段的两半折叠", () => {
  it("首次进行中上报：耗时与 ok 一律 null，不用 0 冒充", () => {
    const [call] = foldSubtaskToolCall([], observation()) as [SubtaskToolCall];
    expect(call.durationMs).toBeNull();
    expect(call.ok).toBeNull();
    expect(call.startedAt).toBe("2026-09-08T10:00:00.000Z");
  });

  it("同一 toolCallId 的完成上报合并进原条目：startedAt 不动，耗时由两个时刻算出", () => {
    const started = foldSubtaskToolCall([], observation());
    const done = foldSubtaskToolCall(started, observation({
      phase: "complete", ok: true, resultSummary: "8 条", argsSummary: null, at: "2026-09-08T10:00:02.400Z",
    }));
    expect(done).toHaveLength(1);
    expect(done[0]!.startedAt).toBe("2026-09-08T10:00:00.000Z");
    expect(done[0]!.durationMs).toBe(2400);
    expect(done[0]!.ok).toBe(true);
    // 后续上报的 null 摘要不覆盖已有值（provider 的 complete 事件常不重复 args）。
    expect(done[0]!.argsSummary).toBe("q");
    expect(done[0]!.resultSummary).toBe("8 条");
  });

  it("不同 toolCallId 各自成条，按首次出现顺序", () => {
    const list = foldSubtaskToolCall(foldSubtaskToolCall([], observation()), observation({ toolCallId: "call-2", toolName: "call_skill" }));
    expect(list.map((c) => c.toolCallId)).toEqual(["call-1", "call-2"]);
  });
});

describe("SubtaskRunStore.recordToolCall —— 持久化并经列表读回", () => {
  it("上报后 listByParentRun 带出真实工具明细；未上报时是空数组", async () => {
    const store = new InMemorySubtaskRunStore();
    const run = await store.enqueue(org, { parentRunId: "parent-1", description: "调研" });
    const other = await store.enqueue(org, { parentRunId: "parent-1", description: "另一条" });
    expect((await store.get(org, other.id))?.toolCalls).toEqual([]);

    await store.recordToolCall(org, run.id, observation());
    await store.recordToolCall(org, run.id, observation({ phase: "complete", ok: false, resultSummary: "超时", at: "2026-09-08T10:00:01.000Z" }));

    const rows = await store.listByParentRun(org, "parent-1");
    const target = rows.find((r) => r.id === run.id)!;
    expect(target.toolCalls).toEqual([{ toolCallId: "call-1", toolName: "web_search", argsSummary: "q",
      resultSummary: "超时", ok: false, startedAt: "2026-09-08T10:00:00.000Z", durationMs: 1000 }]);
    expect(rows.find((r) => r.id === other.id)!.toolCalls).toEqual([]);
  });
});

describe("SubtaskRunExecutor —— 引擎上报接进子任务记录", () => {
  const db = { withTenant: async (_org: unknown, fn: (s: unknown) => Promise<unknown>) =>
    fn({ query: async () => ({ rows: [{ instructions: "system" }] }) }) } as never;
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;

  it("provider 报进度时，工具调用被记录成真实明细（同一次远程执行，不是第二次模型调用）", async () => {
    const store = new InMemorySubtaskRunStore();
    const run = await store.enqueue(org, { parentRunId: "parent-1", description: "调研",
      snapshot: { agentVersionId: "v1", skillVersionIds: [], modelProvider: "deep-agent", modelId: "m1" } });
    const complete = vi.fn();
    const completeWithProgress = vi.fn(async (_input: unknown, onProgress: (e: unknown) => Promise<void>) => {
      await onProgress({ toolCallId: "t-1", toolName: "web_search", toolArgsSummary: "巴伐利亚", toolResultSummary: null, planningNote: null, phase: "in_progress" });
      await onProgress({ toolCallId: "t-1", toolName: "web_search", toolArgsSummary: null, toolResultSummary: "8 条", planningNote: null, phase: "complete", ok: true });
      return { text: "done" };
    });
    const executor = new SubtaskRunExecutor(store, db, { complete, completeWithProgress } as never, logger, false, new Map([["deep-agent", 1000]]));

    await executor.tick(org);

    expect(complete).not.toHaveBeenCalled();
    const finished = (await store.get(org, run.id))!;
    expect(finished.status).toBe("completed");
    expect(finished.toolCalls).toHaveLength(1);
    expect(finished.toolCalls![0]).toMatchObject({ toolName: "web_search", argsSummary: "巴伐利亚", resultSummary: "8 条", ok: true });
    expect(finished.toolCalls![0]!.durationMs).not.toBeNull();
  });

  it("provider 不报进度时逐字退回 complete()，明细如实留空——不造假", async () => {
    const store = new InMemorySubtaskRunStore();
    const run = await store.enqueue(org, { parentRunId: "parent-1", description: "调研",
      snapshot: { agentVersionId: "v1", skillVersionIds: [], modelProvider: "plain", modelId: "m1" } });
    const complete = vi.fn(async () => ({ text: "done" }));
    const executor = new SubtaskRunExecutor(store, db, { complete } as never, logger, false, new Map([["plain", 1000]]));

    await executor.tick(org);

    expect(complete).toHaveBeenCalledTimes(1);
    expect((await store.get(org, run.id))?.toolCalls).toEqual([]);
  });
});
