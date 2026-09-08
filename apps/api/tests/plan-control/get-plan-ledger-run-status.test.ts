/**
 * issue #3099 —— `getPlanLedger` 必须把真实 `runStatus` 下发给前端。
 *
 * 前端的运行级控制（暂停/恢复）判定 `deriveRunControls` 只看这一个字段。此前读模型
 * 只下发 `phase`，而 `phase` 把「正在跑但账本为空」和「什么都没发生」都压成
 * `"preparing"`——前端因此无从知道 run 还在不在，暂停入口消失。
 *
 * 本文件钉住两件事：① 账本为空的运行中 run，`phase==="preparing"` 而
 * `runStatus==="running"`（两者确实不同，`runStatus` 不是 `phase` 的复述）；
 * ② `pausedAt` 非空时 `runStatus` 是 `"interrupted"`（= 可恢复），
 * ③ 终态一律不继承活的控制信号。
 */
import { expect, it, describe } from "vitest";
import { getPlanLedger } from "../../src/application/plan-control/get-plan-ledger";
import type { PlanLedgerRepository, PlanRunStatusReader, PlanRunSnapshot } from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";
import { deriveRunControls } from "@repo/contracts/plan-control";

const emptyRepo = { getLatest: async () => null, listOrphanedConstraints: async () => [] } as unknown as PlanLedgerRepository;

function readerFor(run: PlanRunSnapshot | null): PlanRunStatusReader {
  return {
    getLatestRun: async () => run,
    recordRemoteRunId: async () => { throw new Error("read must not write"); },
    markRunPaused: async () => { throw new Error("read must not write"); },
  };
}

function runSnapshot(overrides: Partial<PlanRunSnapshot> = {}): PlanRunSnapshot {
  return {
    runId: "run-1", status: "running", pausedAt: null, pauseRequestedAt: null, pendingToolName: null,
    createdAt: "2026-09-07T00:00:00Z", agentId: "agent", remoteRunId: null, errorCode: null,
    ...overrides,
  };
}

describe("getPlanLedger.runStatus（#3099）", () => {
  it("账本为空但 run 在跑：phase 是 preparing，runStatus 仍如实是 running ⇒ 可暂停", async () => {
    const out = await getPlanLedger(emptyRepo, readerFor(runSnapshot()), { orgId: toOrgId("org"), threadId: "t" });
    expect(out.steps).toHaveLength(0);
    expect(out.phase).toBe("preparing"); // 这正是旧渲染门读到的、看不出 run 在跑的那个值
    expect(out.runStatus).toBe("running");
    expect(deriveRunControls({ runStatus: out.runStatus })).toEqual({ canPause: true, canResume: false });
  });

  it("已暂停：runStatus 是 interrupted ⇒ 可恢复（此时 activeRunId 已是 null，不能用它判)", async () => {
    const out = await getPlanLedger(
      emptyRepo, readerFor(runSnapshot({ pausedAt: "2026-09-07T00:01:00Z" })), { orgId: toOrgId("org"), threadId: "t" },
    );
    expect(out.runStatus).toBe("interrupted");
    expect(out.activeRunId).toBeNull();
    expect(deriveRunControls({ runStatus: out.runStatus })).toEqual({ canPause: false, canResume: true });
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "终态 %s：runStatus 如实透传，运行级控制全关（#2927 不被放宽）",
    async (status) => {
      const out = await getPlanLedger(
        emptyRepo,
        readerFor(runSnapshot({ status, pausedAt: "2026-09-07T00:01:00Z" })),
        { orgId: toOrgId("org"), threadId: "t" },
      );
      expect(out.runStatus).toBe(status);
      expect(deriveRunControls({ runStatus: out.runStatus })).toEqual({ canPause: false, canResume: false });
    },
  );

  it("该线程没有任何 run：runStatus 是 idle，没有可暂停的对象", async () => {
    const out = await getPlanLedger(emptyRepo, readerFor(null), { orgId: toOrgId("org"), threadId: "t" });
    expect(out.runStatus).toBe("idle");
    expect(deriveRunControls({ runStatus: out.runStatus })).toEqual({ canPause: false, canResume: false });
  });
});
