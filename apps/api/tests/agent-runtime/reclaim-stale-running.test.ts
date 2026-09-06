import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";

/**
 * 2026-08-30（devapp 真实用户复现：切回一条会话，右栏永远停在「正在恢复上次未完成的
 * 任务…」，前端 `useCopilotKitV2RunRestore` 轮询 `GET /agent-runs/:runId` 到 20 分钟
 * 预算耗尽也等不到终态）——根因排到后端：`agent_runs` 的 `running` 是唯一一个没有任何
 * "下一条消息自动捞回"路径的中间态。`claimQueued` 只认领 `status='queued'`，一条已经
 * 被 claim 走、状态翻成 `running` 的行，如果处理它的进程在模型调用返回之前就消失
 * （容器重启/OOM/挂起的网络调用），永远没有第二次机会被碰到——`queued`（下一条消息的
 * kick 重新捞）与 `writeback_pending`（`writeBackPendingRuns` 无条件重试）都明写了
 * 各自的自愈路径，唯独 `running` 没有。见 `ports.ts` `AgentRunStore.reclaimStaleRunning`
 * 与 `agent-run-executor.ts` `tick()` 的完整取证。
 *
 * 这里直接对真实 Postgres 发 INSERT/UPDATE，只信真实实现与真实触发器的回答——同
 * `agent-runs-status-transition-trigger.test.ts` 那份既有纪律，不 mock 仓储层。
 */

const ORG = toOrgId("org-reclaim-stale-running");
const PROJECT = "proj-reclaim-stale-running";
const THREAD = "thread-reclaim-stale-running";
const ACTOR = "u-reclaim-stale-running-actor";

let db: PgDatabase;
let repo: PgAgentRunRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

/**
 * `startedAgo`：这一行的 `started_at` 相对现在的偏移（SQL interval 文本，如
 * `'30 minutes'`）。`agent_runs_failure_shape_check`（见该约束的迁移注释）强制
 * `status='failed'` 必须带 `error_code`、其余状态必须不带——`status === "failed"`
 * 时补一个种子值，不是本函数自己发明的语义。
 */
async function seedRun(
  id: string, status: string, startedAgo: string | null,
): Promise<string> {
  const inputMessageId = `${id}-input`;
  const errorCode = status === "failed" ? "RUN_INTERRUPTED" : null;
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hi", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status, started_at, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9,
               ${startedAgo === null ? "NULL" : `now() - interval '${startedAgo}'`}, $10)`,
      [id, ORG, THREAD, inputMessageId, "agent-reclaim", "agent-version-reclaim", "test-provider", "test-model", status, errorCode],
    ),
  );
  return id;
}

async function readRun(id: string): Promise<{ status: string; errorCode: string | null }> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ status: string; error_code: string | null }>(
      `SELECT status, error_code FROM agent_runs WHERE id = $1`, [id],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`run ${id} not found`);
    return { status: row.status, errorCode: row.error_code };
  });
}

describe("AgentRunStore.reclaimStaleRunning -- the one gap the other two states already closed", () => {
  it("a running run started long ago is reclaimed to failed(RUN_INTERRUPTED)", async () => {
    const id = await seedRun("run-reclaim-old", "running", "30 minutes");
    const reclaimed = await repo.reclaimStaleRunning(ORG, 20 * 60_000);
    expect(reclaimed).toBe(1);
    const after = await readRun(id);
    expect(after.status).toBe("failed");
    expect(after.errorCode).toBe("RUN_INTERRUPTED");
  });

  it("a running run started moments ago is left alone -- a healthy in-flight run must not be reclaimed", async () => {
    const id = await seedRun("run-reclaim-fresh", "running", "10 seconds");
    const reclaimed = await repo.reclaimStaleRunning(ORG, 20 * 60_000);
    expect(reclaimed).toBe(0);
    const after = await readRun(id);
    expect(after.status).toBe("running");
    expect(after.errorCode).toBeNull();
  });

  it("queued/writeback_pending/awaiting_tool_permission/succeeded/failed rows are never touched -- only running", async () => {
    const queued = await seedRun("run-reclaim-queued", "queued", null);
    const writeback = await seedRun("run-reclaim-writeback", "writeback_pending", "30 minutes");
    const approval = await seedRun("run-reclaim-approval", "awaiting_tool_permission", "30 minutes");
    const succeeded = await seedRun("run-reclaim-succeeded", "succeeded", "30 minutes");
    const failed = await seedRun("run-reclaim-failed", "failed", "30 minutes");

    const reclaimed = await repo.reclaimStaleRunning(ORG, 20 * 60_000);
    expect(reclaimed).toBe(0);

    for (const [id, expectedStatus] of [
      [queued, "queued"], [writeback, "writeback_pending"], [approval, "awaiting_tool_permission"],
      [succeeded, "succeeded"], [failed, "failed"],
    ] as const) {
      const after = await readRun(id);
      expect(after.status, `${id} must be untouched`).toBe(expectedStatus);
    }
  });

  it("a run already reclaimed does not get reclaimed a second time (idempotent, no double-log noise)", async () => {
    const id = await seedRun("run-reclaim-twice", "running", "30 minutes");
    expect(await repo.reclaimStaleRunning(ORG, 20 * 60_000)).toBe(1);
    expect(await repo.reclaimStaleRunning(ORG, 20 * 60_000)).toBe(0);
    expect((await readRun(id)).status).toBe("failed");
  });
});


describe("issue #2860 —— 心跳与幽灵 run 回收", () => {
  it("started_at 很久但心跳新鲜的 running 不会被回收（慢 run 一直在心跳）", async () => {
    const id = await seedRun("run-heartbeat-alive", "running", "30 minutes");
    await repo.heartbeatRun(ORG, id);
    expect(await repo.reclaimStaleRunning(ORG, 20 * 60_000)).toBe(0);
    expect((await readRun(id)).status).toBe("running");
  });

  it("心跳只写 running 的行：已终态的行心跳是 no-op", async () => {
    const id = await seedRun("run-heartbeat-done", "succeeded", "1 minute");
    await repo.heartbeatRun(ORG, id);
    const row = await asApp(ORG, (c) => c.query<{ heartbeat_at: string | null }>(`SELECT heartbeat_at FROM agent_runs WHERE id=$1`, [id]));
    expect(row.rows[0]?.heartbeat_at).toBeNull();
  });

  it("sweepOrphanedRuns：跨租户（withoutTenant）把心跳停了超阈值的 running 收敛成 failed(RUN_INTERRUPTED)，新鲜心跳的留下", async () => {
    const { sweepOrphanedRuns } = await import("../../src/infrastructure/agent-run/sweep-orphaned-runs");
    const dead = await seedRun("run-sweep-dead", "running", "5 minutes");
    const alive = await seedRun("run-sweep-alive", "running", "5 minutes");
    await repo.heartbeatRun(ORG, alive);
    const logs: string[] = [];
    const orphaned = await sweepOrphanedRuns(db, { olderThanMs: 2 * 60_000, log: (m) => void logs.push(m) });
    expect(orphaned.map((r) => r.id)).toEqual([dead]);
    expect(orphaned[0]).toMatchObject({ orgId: ORG, threadId: THREAD, remoteRunId: null });
    expect((await readRun(dead))).toEqual({ status: "failed", errorCode: "RUN_INTERRUPTED" });
    expect((await readRun(alive)).status).toBe("running");
    expect(logs).toContain("orphaned agent runs reclaimed");
    // 幂等：第二次什么都不收。
    expect(await sweepOrphanedRuns(db, { olderThanMs: 2 * 60_000 })).toEqual([]);
  });
});
