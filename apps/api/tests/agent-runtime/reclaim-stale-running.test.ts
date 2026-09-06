import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";

/** Expired local heartbeats authorize only a fenced read of the original remote
 * operation. They never prove remote failure or authorize replaying tools. */
const ORG = toOrgId("org-reclaim-stale-running");
const PROJECT = "proj-reclaim-stale-running";
const THREAD = "thread-reclaim-stale-running";
const ACTOR = "u-reclaim-stale-running-actor";

let db: PgDatabase;
let repo: PgAgentRunRepository;
const reconcileExistingRun=vi.fn();
let recovery:PgRunRecovery;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
  recovery=new PgRunRecovery(db,repo,{reconcileExistingRun});
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  reconcileExistingRun.mockReset().mockResolvedValue({kind:"failed",diagnostic:"remote_error"});
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
      [id, ORG, THREAD, inputMessageId, "agent-reclaim", "agent-version-reclaim", "deep-agent", "test-model", status, errorCode],
    ),
  );
  await asApp(ORG,c=>c.query("UPDATE agent_runs SET remote_run_id=$2 WHERE id=$1",[id,`remote-${id}`]));
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

describe("Expired lease reconciliation preserves running and terminal state boundaries", () => {
  it("an expired local run becomes failed only after the original remote confirms failure", async () => {
    const id = await seedRun("run-reclaim-old", "running", "30 minutes");
    const reclaimed = await recovery.tick(ORG);
    expect(reclaimed).toBe(1);
    const after = await readRun(id);
    expect(after.status).toBe("failed");
    expect(after.errorCode).toBe("RUN_INTERRUPTED");
    expect(reconcileExistingRun).toHaveBeenCalledWith(THREAD,`remote-${id}`,id);
  });

  it("a running run started moments ago is left alone -- a healthy in-flight run must not be reclaimed", async () => {
    const id = await seedRun("run-reclaim-fresh", "running", "10 seconds");
    const reclaimed = await recovery.tick(ORG);
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
    const paused = await seedRun("run-reclaim-paused", "paused", "30 minutes");
    const cancelled = await seedRun("run-reclaim-cancelled", "cancelled", "30 minutes");

    const reclaimed = await recovery.tick(ORG);
    expect(reclaimed).toBe(0);

    for (const [id, expectedStatus] of [
      [queued, "queued"], [writeback, "writeback_pending"], [approval, "awaiting_tool_permission"],
      [succeeded, "succeeded"], [failed, "failed"], [paused,"paused"], [cancelled,"cancelled"],
    ] as const) {
      const after = await readRun(id);
      expect(after.status, `${id} must be untouched`).toBe(expectedStatus);
    }
  });

  it("a run already reclaimed does not get reclaimed a second time (idempotent, no double-log noise)", async () => {
    const id = await seedRun("run-reclaim-twice", "running", "30 minutes");
    expect(await recovery.tick(ORG)).toBe(1);
    expect(await recovery.tick(ORG)).toBe(0);
    expect((await readRun(id)).status).toBe("failed");
  });
});


describe("issue #2860 —— 心跳与幽灵 run 回收", () => {
  it("started_at 很久但心跳新鲜的 running 不会被回收（慢 run 一直在心跳）", async () => {
    const id = await seedRun("run-heartbeat-alive", "running", "30 minutes");
    await repo.heartbeatRun(ORG, id);
    expect(await recovery.tick(ORG)).toBe(0);
    expect((await readRun(id)).status).toBe("running");
  });

  it("心跳只写 running 的行：已终态的行心跳是 no-op", async () => {
    const id = await seedRun("run-heartbeat-done", "succeeded", "1 minute");
    await repo.heartbeatRun(ORG, id);
    const row = await asApp(ORG, (c) => c.query<{ heartbeat_at: string | null }>(`SELECT heartbeat_at FROM agent_runs WHERE id=$1`, [id]));
    expect(row.rows[0]?.heartbeat_at).toBeNull();
  });

  it("sweep discovers expired runs but only tenant-scoped remote reconciliation can settle them", async () => {
    const { sweepOrphanedRuns } = await import("../../src/infrastructure/agent-run/sweep-orphaned-runs");
    const dead = await seedRun("run-sweep-dead", "running", "5 minutes");
    const alive = await seedRun("run-sweep-alive", "running", "5 minutes");
    await repo.heartbeatRun(ORG, alive);
    const logs: string[] = [];
    const orphaned = await sweepOrphanedRuns(db, { olderThanMs: 2 * 60_000, log: (m) => void logs.push(m), reconcile:async orgId=>recovery.tick(toOrgId(orgId)) });
    const tenantOrphans = orphaned.filter((run) => run.orgId === ORG);
    expect(tenantOrphans.map((r) => r.id)).toEqual([dead]);
    expect(tenantOrphans[0]).toMatchObject({ orgId: ORG, threadId: THREAD, remoteRunId: `remote-${dead}` });
    expect((await readRun(dead))).toEqual({ status: "failed", errorCode: "RUN_INTERRUPTED" });
    expect((await readRun(alive)).status).toBe("running");
    expect(logs).toContain("orphaned agent runs reclaimed");
    // 幂等：第二次什么都不收。
    expect((await sweepOrphanedRuns(db, { olderThanMs: 2 * 60_000 })).filter((run) => run.orgId === ORG)).toEqual([]);
  });
});

describe("uncertain recovery never submits a second operation",()=>{
  it("keeps an unreachable remote run visible and does not retry before lease expiry",async()=>{
    const id=await seedRun("run-offline","running","30 minutes");
    reconcileExistingRun.mockResolvedValue({kind:"uncertain",diagnostic:"remote_reconcile_unavailable"});
    expect(await recovery.tick(ORG)).toBe(1);
    expect(await recovery.tick(ORG)).toBe(0);
    expect(reconcileExistingRun).toHaveBeenCalledTimes(1);
    expect((await readRun(id)).status).toBe("running");
    expect(await repo.reclaimStaleRunning(ORG,1)).toBe(0);
    expect((await readRun(id)).status).toBe("running");
  });
  it("continues observing a healthy remote operation after local lease loss",async()=>{
    const id=await seedRun("run-remote-still-live","running","30 minutes");
    reconcileExistingRun.mockResolvedValue({kind:"running"});
    expect(await recovery.tick(ORG)).toBe(1);expect((await readRun(id))).toEqual({status:"running",errorCode:null});
    expect(await recovery.tick(ORG)).toBe(0);expect(reconcileExistingRun).toHaveBeenCalledTimes(1);
  });
  it("never calls a remote when the submission id is missing",async()=>{
    const id=await seedRun("run-no-remote-id","running","30 minutes");
    await asApp(ORG,c=>c.query("UPDATE agent_runs SET remote_run_id=NULL WHERE id=$1",[id]));
    expect(await recovery.tick(ORG)).toBe(1);expect(reconcileExistingRun).not.toHaveBeenCalled();
    expect((await readRun(id)).status).toBe("running");
  });
  it("cannot claim another organization's expired work",async()=>{
    const id=await seedRun("run-tenant-boundary","running","30 minutes");
    expect(await recovery.tick(toOrgId("org-unrelated-recovery"))).toBe(0);
    expect(reconcileExistingRun).not.toHaveBeenCalled();expect((await readRun(id)).status).toBe("running");
  });
});
