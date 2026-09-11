/**
 * issue #3439 —— `requeueAuthorizedToolCall`（#3420，`running → queued`，已授权工具
 * 自动续跑）赶不上同一 tick 里已经跑过的那次 `claimQueued`，调用点又没有像
 * `decideToolPermission` 那样补一次 `kick()`——这条 run 因此没有任何机制会再去
 * `claimQueued` 它，除非**碰巧**同一个组织的另一条线程送来一条新消息。
 *
 * 本文件直接在数据库层重放人类实测的那一行（run 49fd3220 的形状：`status='queued'`、
 * `pending_decision='approve'`、`lease_expires_at` 早已过期、`recovery_attempts=0`），
 * 不经过完整的 model/execute-run 链路——`requeueAuthorizedToolCall` 自己的 SQL 单元测试
 * 覆盖的是"这条 UPDATE 语句对不对"，这里要证的是"这一行卡住之后，系统里到底有没有
 * 谁会再碰它"，两者是不同的断言。
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { sweepOrphanedRuns } from "../../src/infrastructure/agent-run/sweep-orphaned-runs";

const ORG = toOrgId("org-stale-queued-requeue");
const PROJECT = "proj-stale-queued-requeue";
const THREAD = "thread-stale-queued-requeue";
const ACTOR = "u-stale-queued-requeue-actor";

let db: PgDatabase;
let repo: PgAgentRunRepository;
const reconcileExistingRun = vi.fn();
let recovery: PgRunRecovery;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
  recovery = new PgRunRecovery(db, repo, { reconcileExistingRun });
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  reconcileExistingRun.mockReset().mockResolvedValue({ kind: "failed", diagnostic: "remote_error" });
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  // `claimQueued` 的 detail 查询 JOIN `agent_versions`——不像 `PgRunRecovery.tick`（只读
  // `agent_runs` 自身），这里要真的能被 claim 走，就需要一条真实可解析的 pinned 版本。
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES('agent-stale-queued',$1,'stale-queued-agent','Stale Queued Agent','enabled',$2,now(),now())`,
    [ORG, ACTOR],
  ));
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
       skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
     VALUES('agent-version-stale-queued',$1,'agent-stale-queued','v1',$2,'pinned instructions','{}','deep-agent','test-model','[]',$3,now(),now())`,
    [ORG, createHash("sha256").update("pinned instructions").digest("hex"), ACTOR],
  ));
});

/**
 * 重放 `requeueAuthorizedToolCall` 成功执行之后、这一行会落成的样子：`status='queued'`、
 * `pending_decision='approve'`，`lease_epoch`/`lease_expires_at` 原样保留自它作为
 * `running` 时最后一次心跳/认领（`requeueAuthorizedToolCall` 的 UPDATE 不碰这两列，
 * 见 `pg-agent-run-repository.ts:576`）——这正是它早已过期的原因。
 */
async function seedStuckRequeuedRun(id: string, leaseExpiredAgo: string): Promise<string> {
  const inputMessageId = `${id}-input`;
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "帮我做一个 Excel 表格", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status, started_at, heartbeat_at,
          lease_epoch, lease_expires_at, recovery_attempts, pending_decision, pending_tool_name)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'queued',
               now() - interval '20 minutes', now() - interval '20 minutes',
               2, now() - interval '${leaseExpiredAgo}', 0, 'approve', 'execute')`,
      [id, ORG, THREAD, inputMessageId, "agent-stale-queued", "agent-version-stale-queued", "deep-agent", "test-model"],
    ),
  );
  return id;
}

async function readStatus(id: string): Promise<string> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ status: string }>(`SELECT status FROM agent_runs WHERE id = $1`, [id]);
    const row = r.rows[0];
    if (!row) throw new Error(`run ${id} not found`);
    return row.status;
  });
}

describe("issue #3439 —— requeueAuthorizedToolCall 之后卡死的 queued 行必须被回收", () => {
  it("kernel_stale_queued_agent_run_orgs 发现这一行所在的组织（只读，不改这行本身）", async () => {
    const id = await seedStuckRequeuedRun("run-stale-queued-discover", "12 minutes");
    const rows = await db.withoutTenant((s) => s.query<{ org_id: string }>(
      `SELECT org_id FROM kernel_stale_queued_agent_run_orgs($1)`, [120_000],
    ));
    expect(rows.rows.map((r) => r.org_id)).toContain(ORG);
    // 只读——这一行的状态原封不动。
    expect(await readStatus(id)).toBe("queued");
  });

  it("一个刚创建、还没被 claim 过的健康 queued 行不会被当成卡住（lease/heartbeat/started_at 全 NULL）", async () => {
    const inputMessageId = "run-fresh-queued-input";
    await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hi", authorId: ACTOR });
    await asApp(ORG, (c) => c.query(
      `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
         skill_version_ids, model_provider, model_id, status)
       VALUES ('run-fresh-queued',$1,$2,$3,$4,$5,'[]'::jsonb,$6,$7,'queued')`,
      [ORG, THREAD, inputMessageId, "agent-fresh", "agent-version-fresh", "deep-agent", "test-model"],
    ));
    const rows = await db.withoutTenant((s) => s.query<{ org_id: string }>(
      `SELECT org_id FROM kernel_stale_queued_agent_run_orgs($1)`, [120_000],
    ));
    expect(rows.rows.map((r) => r.org_id)).not.toContain(ORG);
  });

  it("sweepOrphanedRuns 现在会为这个组织调用 reconcile——即便它一个 running 孤儿都没有", async () => {
    await seedStuckRequeuedRun("run-stale-queued-reconcile", "12 minutes");
    const reconciled: string[] = [];
    await sweepOrphanedRuns(db, {
      olderThanMs: 2 * 60_000,
      reconcile: async (orgId) => { reconciled.push(orgId); },
    });
    expect(reconciled).toContain(ORG);
  });

  it("三步反证之三：reconcile 真的把 claimQueued 接到，卡死的行从 queued 变成 running 并继续推进", async () => {
    const id = await seedStuckRequeuedRun("run-stale-queued-recovers", "12 minutes");
    expect(await readStatus(id)).toBe("queued");

    const claimedRunIds: string[] = [];
    await sweepOrphanedRuns(db, {
      olderThanMs: 2 * 60_000,
      reconcile: async (orgIdStr) => {
        const orgId = toOrgId(orgIdStr);
        // 生产里这里是 `AgentRunExecutor.tick`，其核心正是这一句 `claimQueued`——
        // 直接用真实仓储验证它现在真的被调用到、真的认领到了这一行。
        const outcomes = await repo.claimQueued(orgId, 10);
        for (const outcome of outcomes) {
          if (outcome.kind !== "unresolvable") claimedRunIds.push(outcome.run.runId);
        }
      },
    });

    expect(claimedRunIds).toContain(id);
    expect(await readStatus(id)).toBe("running");
  });
});
