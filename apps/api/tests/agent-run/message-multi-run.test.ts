/**
 * F05 (`streaming-transport` 契约束 R4 E4) —— 放开「一条用户消息只能对应一个 run」
 * 约束，支持一个逻辑 run 多次续跑，多次续跑记录仍映射到同一条用户消息。
 *
 * ## 这份测试钉住的边界
 *
 *   ① `agent_runs` 的 `UNIQUE (org_id, input_message_id)`（#415/#519）**原样成立**——
 *      F05 不碰它，见 `run-attempts.ts` 头注。「一个逻辑 run 多次续跑」走的是新表
 *      `agent_run_attempts`，本文件对真实 Postgres 发 INSERT/SELECT，同
 *      `reclaim-stale-running.test.ts` 那份既有纪律，不 mock 仓储层。
 *   ② 同一 `messageId`（经由它唯一对应的那个 `agent_runs.id`）可以关联多条续跑记录，
 *      `attemptSeq` 从 1 开始递增；断线重连后的续跑携带上一次留下的
 *      `resumedFromCheckpointId`——「从 checkpoint 接续」。
 *   ③ `agent_run_attempts.status` 的 CHECK 取值集合与
 *      `packages/contracts/src/streaming-transport.ts` 的 `AgentKernelRunStatus`
 *      是同一份事实（同 `no-tool-run-writeback.test.ts` 对 `agent_run_steps` 的既有
 *      先例：读 `pg_constraint` 断言两边集合相等，而不是分别手写两份再祈祷不漂移）。
 *   ④ 续跑记录只 append，不可更新/删除（同 `agent_run_steps` 的既有先例）。
 *   ⑤ `listRunAttemptsForMessage` 用例层在读取续跑记录前先过
 *      `resolveVisibility`，拒绝时抛出、绝不往下读——同
 *      `agent-run-context-snapshot-repo-guard.test.ts` 的既有断言形状（源码级顺序
 *      检查，不需要为此搭一整套 identity/authorize 真栈）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { streamingTransport as ST } from "@repo/contracts";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunAttemptRepository } from "../../src/infrastructure/agent-run/pg-agent-run-attempt-repository";

const ORG = toOrgId("org-f05-multi-run");
const PROJECT = "proj-f05-multi-run";
const THREAD = "thread-f05-multi-run";
const ACTOR = "u-f05-multi-run-actor";

let db: PgDatabase;
let repo: PgAgentRunAttemptRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunAttemptRepository(db);
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

/** 一条人类消息 + 触发它的那一个（唯一的）`agent_runs` 行——F05 不新增第二个。 */
async function seedRun(runId: string, messageId: string): Promise<void> {
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body: "hi", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,'agent-f05','agent-version-f05','[]'::jsonb,'test-provider','test-model','running')`,
      [runId, ORG, THREAD, messageId],
    ),
  );
}

describe("F05 一逻辑 run 多次续跑，仍映射到同一条用户消息", () => {
  it("① agent_runs 上 UNIQUE(org_id, input_message_id) 原样成立 —— F05 不碰它", async () => {
    const index = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_runs'::regclass AND contype='u'
          AND pg_get_constraintdef(oid) LIKE '%input_message_id%'`,
    ));
    expect(index.rows, "#519 裁定优先的那条约束必须还在").toHaveLength(1);
    expect(index.rows[0]!.def).toContain("org_id");
    expect(index.rows[0]!.def).toContain("input_message_id");
  });

  it("② 同一 messageId 可关联多条续跑记录，attemptSeq 从 1 递增，续跑从 checkpoint 接续", async () => {
    const runId = "run-f05-multi";
    const messageId = "msg-f05-multi";
    await seedRun(runId, messageId);

    const first = await repo.recordAttempt(ORG, {
      runId, resumedFromCheckpointId: null, status: "running",
    });
    expect(first).toEqual({
      runId, attemptSeq: 1, messageId, resumedFromCheckpointId: null,
      status: "running", createdAt: first.createdAt,
    });

    // 断线；重连后从上一次留下的 checkpoint 续跑。
    const second = await repo.recordAttempt(ORG, {
      runId, resumedFromCheckpointId: "checkpoint-1", status: "running",
    });
    expect(second.attemptSeq).toBe(2);
    expect(second.resumedFromCheckpointId).toBe("checkpoint-1");
    expect(second.messageId).toBe(messageId);
    expect(second.runId).toBe(runId);

    // 再断一次，从第二个 checkpoint 续跑，最终成功。
    const third = await repo.recordAttempt(ORG, {
      runId, resumedFromCheckpointId: "checkpoint-2", status: "succeeded",
    });
    expect(third.attemptSeq).toBe(3);

    const attempts = await repo.listForMessage(ORG, messageId);
    expect(attempts.map((a) => a.attemptSeq)).toEqual([1, 2, 3]);
    expect(attempts.every((a) => a.messageId === messageId)).toBe(true);
    expect(attempts.every((a) => a.runId === runId)).toBe(true);
    expect(attempts.map((a) => a.resumedFromCheckpointId)).toEqual([null, "checkpoint-1", "checkpoint-2"]);
    expect(attempts.map((a) => a.status)).toEqual(["running", "running", "succeeded"]);
  });

  it("② 之二：一条从未续跑过的消息只有一条 attempt（首次执行本身就是 attemptSeq 1）", async () => {
    const runId = "run-f05-single";
    const messageId = "msg-f05-single";
    await seedRun(runId, messageId);
    await repo.recordAttempt(ORG, { runId, resumedFromCheckpointId: null, status: "succeeded" });

    const attempts = await repo.listForMessage(ORG, messageId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.attemptSeq).toBe(1);
  });

  it("② 之三：不同消息的续跑记录互不串——查一条消息看不到另一条消息的 attempts", async () => {
    const runA = "run-f05-a"; const messageA = "msg-f05-a";
    const runB = "run-f05-b"; const messageB = "msg-f05-b";
    await seedRun(runA, messageA);
    await seedRun(runB, messageB);
    await repo.recordAttempt(ORG, { runId: runA, resumedFromCheckpointId: null, status: "running" });
    await repo.recordAttempt(ORG, { runId: runA, resumedFromCheckpointId: "cp-a", status: "succeeded" });
    await repo.recordAttempt(ORG, { runId: runB, resumedFromCheckpointId: null, status: "failed" });

    expect((await repo.listForMessage(ORG, messageA)).map((a) => a.attemptSeq)).toEqual([1, 2]);
    expect((await repo.listForMessage(ORG, messageB)).map((a) => a.attemptSeq)).toEqual([1]);
  });

  it("③ status 的 CHECK 取值集合与 AgentKernelRunStatus 是同一份事实", async () => {
    const constraint = await asOwner((c) => c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='agent_run_attempts'::regclass AND conname='agent_run_attempts_status_check'`,
    ));
    const declared = [...constraint.rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(declared.length, "读到零个状态 —— 这条断言在空转").toBeGreaterThan(0);
    expect(new Set(declared)).toEqual(new Set(ST.AgentKernelRunStatus.options));
  });

  it("④ 续跑记录只 append：直接 UPDATE/DELETE 被拒绝（跑流量的角色），INSERT 仍然可用", async () => {
    const runId = "run-f05-append-only";
    const messageId = "msg-f05-append-only";
    await seedRun(runId, messageId);
    await repo.recordAttempt(ORG, { runId, resumedFromCheckpointId: null, status: "running" });

    await asApp(ORG, async (c) => {
      await expect(c.query(
        `UPDATE agent_run_attempts SET status='succeeded' WHERE org_id=$1 AND run_id=$2`, [ORG, runId],
      )).rejects.toThrow();
    });
    await asApp(ORG, async (c) => {
      await expect(c.query(
        `DELETE FROM agent_run_attempts WHERE org_id=$1 AND run_id=$2`, [ORG, runId],
      )).rejects.toThrow();
    });
    // 非空转：同一个角色、同一张表，INSERT 仍然成立——上面两条拒绝拒的是 UPDATE/DELETE
    // 本身，不是这个角色完全碰不到这张表（同 `no-tool-run-writeback.test.ts` 对
    // `agent_run_steps` 的既有先例）。
    await repo.recordAttempt(ORG, { runId, resumedFromCheckpointId: "cp-append-only", status: "succeeded" });
  });

  /**
   * 同上一条注释里点名的既有先例：单独的行为测试看不出「拒绝来自 GRANT 还是来自
   * 触发器」，两套机制都要留着——今天任何一个单独存在都够用，撤掉一个的那天，
   * 另一个才第一次成为唯一的防线。
   */
  it("④ 之二：两套机制都在——GRANT 只给 SELECT/INSERT，且 append-only 触发器存在", async () => {
    const privileges = await asOwner((c) => c.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_name='agent_run_attempts' AND grantee='app_rw'`,
    ));
    expect(new Set(privileges.rows.map((r) => r.privilege_type)))
      .toEqual(new Set(["SELECT", "INSERT"]));

    const trigger = await asOwner((c) => c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid='agent_run_attempts'::regclass AND NOT tgisinternal`,
    ));
    expect(trigger.rows.map((r) => r.tgname)).toContain("agent_run_attempts_append_only_trg");
  });

  it("⑤ listRunAttemptsForMessage 在读取续跑记录前先过 resolveVisibility，拒绝时抛出、绝不往下读", () => {
    const source = readFileSync(
      join(__dirname, "../../src/application/agent-run/run-attempts.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fnBody = /export async function listRunAttemptsForMessage[\s\S]*$/.exec(source)?.[0] ?? "";
    expect(fnBody).not.toBe("");

    const resolveIndex = fnBody.indexOf("resolveVisibility(");
    const listIndex = fnBody.indexOf("deps.attempts.listForMessage(");
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeLessThan(listIndex);

    const between = fnBody.slice(resolveIndex, listIndex);
    expect(between).toContain("outcome.kind !== \"allow\"");
    expect(between).toContain("throw new MessageNotVisibleForAttemptsError()");
  });
});
