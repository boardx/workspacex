/**
 * 异步子任务派发（issue #2664）+ 后台任务面板查询接口（issue #2666）——
 * `subtask-run-queue.ts` 的"领取 → 执行 → 写回终态"链路，以及新增的
 * `listByParentRun`（供 `GET /agent-runs/:runId/subtask-runs` 用）。这是纯应用层代码，
 * 对 `SubtaskRunStore` 端口编程，一份全内存实现（`InMemorySubtaskRunStore`，本身即是
 * 生产 MVP）就能证明这条链路本身，不需要真实数据库。
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { InMemorySubtaskRunStore } from "../../src/infrastructure/agent-run/in-memory-subtask-run-store";
import {
  executeQueuedSubtaskRuns, type SubtaskRun,
} from "../../src/application/agent-run/subtask-run-queue";

const ORG = toOrgId("org-subtask-run-queue");

function noopLog(): void {
  /* tests assert on store state, not log calls */
}

describe("spawn_async_task -- enqueue never blocks on execution (issue #2664)", () => {
  it("enqueue returns immediately with status pending, before any execution happens", async () => {
    const store = new InMemorySubtaskRunStore(() => "subtask-1");
    const run = await store.enqueue(ORG, {
      parentRunId: "run-parent-1", description: "调研子任务 A",
    });
    expect(run.status).toBe("pending");
    expect(run.result).toBeNull();
    expect(run.error).toBeNull();
    expect(run.parentRunId).toBe("run-parent-1");
  });

  it("three parallel subtasks enqueued for the same parent run are all claimable in one batch", async () => {
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "子任务 1" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "子任务 2" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "子任务 3" });

    const claimed = await store.claimQueued(ORG, 10);

    expect(claimed).toHaveLength(3);
    expect(claimed.every((r) => r.status === "running")).toBe(true);
    expect(claimed.map((r) => r.description).sort()).toEqual(["子任务 1", "子任务 2", "子任务 3"]);
  });

  it("executeQueuedSubtaskRuns claims, executes, and completes -- a full enqueue -> claim -> terminal cycle", async () => {
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "画一张架构图" });

    const executed: SubtaskRun[] = [];
    const count = await executeQueuedSubtaskRuns(
      {
        store,
        execute: async (run) => { executed.push(run); return `已完成：${run.description}`; },
        log: noopLog,
      },
      { orgId: ORG },
    );

    expect(count).toBe(1);
    expect(executed).toHaveLength(1);
    const after = await store.get(ORG, "subtask-1");
    expect(after?.status).toBe("completed");
    expect(after?.result).toBe("已完成：画一张架构图");
    expect(after?.error).toBeNull();
  });

  it("a failed subtask records status=failed with the error, and does not affect the other subtasks in the same batch", async () => {
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "会失败的子任务" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "会成功的子任务" });

    const count = await executeQueuedSubtaskRuns(
      {
        store,
        execute: async (run) => {
          if (run.description === "会失败的子任务") throw new Error("simulated subtask failure");
          return "成功结果";
        },
        log: noopLog,
      },
      { orgId: ORG },
    );

    expect(count).toBe(2);
    const failed = await store.get(ORG, "subtask-1");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("simulated subtask failure");
    expect(failed?.result).toBeNull();

    const succeeded = await store.get(ORG, "subtask-2");
    expect(succeeded?.status).toBe("completed");
    expect(succeeded?.result).toBe("成功结果");
    expect(succeeded?.error).toBeNull();
  });

  it("claiming is scoped per org -- another org's pending subtasks are never claimed", async () => {
    const otherOrg = toOrgId("org-subtask-run-queue-other");
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "org-1 的子任务" });

    const claimedForOther = await store.claimQueued(otherOrg, 10);

    expect(claimedForOther).toHaveLength(0);
  });

  it("context is optional -- absent context enqueues as null, not dropped or throwing", async () => {
    const store = new InMemorySubtaskRunStore(() => "subtask-1");
    const withContext = await store.enqueue(ORG, {
      parentRunId: "run-parent-1", description: "有上下文", context: "父任务已确认的事实",
    });
    const withoutContext = await store.enqueue(ORG, {
      parentRunId: "run-parent-1", description: "无上下文",
    });
    expect(withContext.context).toBe("父任务已确认的事实");
    expect(withoutContext.context).toBeNull();
  });
});

describe("listByParentRun -- issue #2666's read path for the background task panel", () => {
  it("returns every subtask run for a given parent run, in enqueue order", async () => {
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "子任务 A" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "子任务 B" });
    await store.enqueue(ORG, { parentRunId: "run-parent-2", description: "另一个父 run 的子任务" });

    const runs = await store.listByParentRun(ORG, "run-parent-1");

    expect(runs.map((r) => r.description)).toEqual(["子任务 A", "子任务 B"]);
  });

  it("an unknown parent run returns an empty list, not null or a throw", async () => {
    const store = new InMemorySubtaskRunStore();
    const runs = await store.listByParentRun(ORG, "run-parent-does-not-exist");
    expect(runs).toEqual([]);
  });

  it("reflects live status transitions -- pending/running/completed/failed all show up", async () => {
    let n = 0;
    const store = new InMemorySubtaskRunStore(() => `subtask-${(n += 1)}`);
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "会完成" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "会失败" });
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "还在排队" });

    const claimed = await store.claimQueued(ORG, 2);
    await store.complete(ORG, claimed[0]!.id, "完成结果");
    await store.fail(ORG, claimed[1]!.id, "失败原因");

    const runs = await store.listByParentRun(ORG, "run-parent-1");
    const byId = new Map(runs.map((r) => [r.id, r]));
    expect(byId.get("subtask-1")?.status).toBe("completed");
    expect(byId.get("subtask-2")?.status).toBe("failed");
    expect(byId.get("subtask-3")?.status).toBe("pending");
  });

  it("is scoped per org -- another org never sees these subtask runs", async () => {
    const otherOrg = toOrgId("org-subtask-run-queue-other");
    const store = new InMemorySubtaskRunStore(() => "subtask-1");
    await store.enqueue(ORG, { parentRunId: "run-parent-1", description: "org-1 的子任务" });

    const runs = await store.listByParentRun(otherOrg, "run-parent-1");

    expect(runs).toEqual([]);
  });
});

it("WX-T042 memory adapter mirrors explicit replay idempotency and terminal immutability", async () => {
  const store = new InMemorySubtaskRunStore();
  const input = { parentRunId: "parent",description: "task",idempotencyKey: "tool-call" };
  const first = await store.enqueue(ORG,input);
  expect((await store.enqueue(ORG,input)).id).toBe(first.id);
  await expect(store.enqueue(ORG,{ ...input,description: "changed" })).rejects.toThrow("subtask_idempotency_conflict");
  await store.claimQueued(ORG,1);
  await store.complete(ORG,first.id,"result");
  await store.fail(ORG,first.id,"late failure");
  expect((await store.get(ORG,first.id))?.result).toBe("result");
});
