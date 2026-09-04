/**
 * 异步子任务派发（issue #2664）—— `subtask-run-queue.ts` 的"领取 → 执行 → 写回终态"
 * 链路。同 `execute-run-progress.test.ts`（#742）一条既有先例：这是纯应用层代码，对
 * `SubtaskRunStore` 端口编程，一份全内存 fake 就能证明这条链路本身，不需要真实数据库
 * ——`InMemorySubtaskRunStore` 恰好就是这份"fake"同时也是生产 MVP 实现，这里直接用它，
 * 不额外造第二份。
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
