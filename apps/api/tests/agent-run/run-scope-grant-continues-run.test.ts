/**
 * issue #3420 —— 用户选了「本 run 内都允许」之后，**同一条 run 内同一个工具**不得再被
 * 拦住等人。
 *
 * # 判据落在授权判定这一层，不是界面上
 *
 * 「界面上没有再弹框」是时序巧合也能满足的判据（第二次中断还没到、或者 run 刚好卡住不动，
 * 界面同样什么都不弹）。所以这里的断言全部落在**授权判定之后 run 的真实状态**上：
 * 已授权 ⇒ run 必须回到「可以继续跑」的状态（`queued` + `pending_decision='approve'`，
 * 也就是 executor 下一拍能领走、provider 能据此发 resume 的那个状态），
 * 而不是仅仅「不是 awaiting_tool_permission」。
 *
 * ## 两条会再问一次的真实路径（都走真库）
 *
 * ① `tool-permission-gate.ts`：内核每次 `execute` 都 interrupt（`nativeInterruptOn()` 把
 *    每个 L2 工具都置成 true），网关据 `hasGrant` 决定自动放行还是停下问人。
 *    自动放行分支此前调 `approveAndRequeue`——那条 UPDATE 的 WHERE 是
 *    `status='awaiting_tool_permission'`，而此刻 run 正是 `running`（它就在执行中被中断的），
 *    命中 0 行、返回值被丢弃：run 既没被叫停也没被重新入队，停在 `running` 不动。
 * ② `pg-run-recovery.ts`：①留下的那条不动的 run 租约到期后被恢复流程捞起，远端读回来
 *    「停在一个待批工具调用上」，恢复流程**完全不看授权存储**，直接
 *    `markAwaitingToolPermission` —— 用户于是被同一个工具第二次叫醒。
 */
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgToolPermissionGrantRepository } from "../../src/infrastructure/agent-run/pg-tool-permission-grant-repository";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { handleInterruptedToolCall } from "../../src/application/agent-run/tool-permission-gate";
import type { ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ReconciledRemoteRun } from "../../src/application/agent-run/run-recovery";

const ORG = "org-run-scope-grant-3420";
const org = toOrgId(ORG);
const RUN = "run-scope-grant-run";
/** 人类实测里被第二次拦下的就是它（issue #3420 的 `tool_name`）。 */
const TOOL = "execute";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

async function runRow(): Promise<{ status: string; pending_decision: string | null; pending_tool_name: string | null }> {
  return asApp(ORG, async (c) => (await c.query(
    "SELECT status,pending_decision,pending_tool_name FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0]);
}

async function seedRunningRun(leaseExpiresSql: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `UPDATE agent_runs SET status='running', pending_decision=NULL, pending_tool_name=NULL,
         pending_args_summary=NULL, pending_permission_request_id=NULL,
         lease_epoch=2, lease_expires_at=${leaseExpiresSql}, started_at=now()-interval '1 minute',
         heartbeat_at=now()-interval '1 minute'
       WHERE org_id=$1 AND id=$2`, [ORG, RUN],
    );
  });
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "grant-project" });
  await addChatThread({ orgId: ORG, id: "grant-thread", projectId: null, visibilityScope: "plenary", createdBy: "grant-user" });
  await addChatMessage({ orgId: ORG, id: "grant-input", threadId: "grant-thread", body: "做一个 5 页的 PPT", authorId: "grant-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('grant-agent',$1,'grant-agent','grant-agent','enabled','grant-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('grant-version',$1,'grant-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'grant-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at,remote_run_id,remote_thread_id) VALUES('${RUN}',$1,'grant-thread','grant-input','grant-agent','grant-version','[]','deep-agent','deep-agent','running',now()-interval '1 minute',2,now()+interval '1 minute','remote-run-1','remote-thread-1')`, [ORG]);
  });
});

/** 用户在第一次权限门上真的点了「本 run 内都允许」——授权由产品路径落库，不是测试手插一行。 */
async function userChoosesRunScope(repo: PgAgentRunRepository): Promise<void> {
  await repo.markAwaitingToolPermission(org, RUN, { toolName: TOOL, argsSummary: "{\"command\":\"cd /workspace && node team-collab.js\"}" });
  const requestId = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "run", "grant-user")).toBe(true);
  const granted = await asApp(ORG, async (c) => (await c.query(
    "SELECT scope,run_id,tool_name FROM tool_permission_grants WHERE org_id=$1", [ORG],
  )).rows);
  expect(granted, "前置：run 级授权必须真的落库，否则后面测的不是这条缺陷").toEqual([
    { scope: "run", run_id: RUN, tool_name: TOOL },
  ]);
}

it("① 内核下一次 interrupt 同一个工具：网关判定已授权 ⇒ run 真的回到可继续执行的状态", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await userChoosesRunScope(repo);
  // 用户裁决后 executor 领走 run 继续跑：此刻 run 是 running，中断就发生在这中间。
  await seedRunningRun("now()+interval '1 minute'");

  const deps = {
    runs: repo, toolPermissionGrants: grants,
    clock: { now: () => new Date().toISOString() },
    log: () => {},
  } as unknown as ExecuteAgentRunDeps;

  const outcome = await handleInterruptedToolCall(deps, org, RUN, { toolName: TOOL, argsSummary: "{\"command\":\"python3 render-office.py\"}" }, {
    seq: 50, modelStartedAt: new Date().toISOString(), systemDigest: "b".repeat(64), system: "system",
  });

  expect(outcome.autoApproved, "已授权的同一工具不该停下来等人").toBe(true);
  const row = await runRow();
  expect(row.status, "停在 running 等于「自动放行」只是嘴上说说：没人会再去领它，run 就地不动").toBe("queued");
  expect(row.pending_decision, "重新入队必须带上 approve，provider 据此发 resume").toBe("approve");
  expect(row.status).not.toBe("awaiting_tool_permission");
});

it("② 恢复流程读回「停在待批工具调用上」：已授权的工具不得被第二次叫醒", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  await userChoosesRunScope(repo);
  // ① 之后 run 停在 running 不动，租约到期被恢复流程捞起——这正是人类第二次被叫醒的时刻。
  await seedRunningRun("now()-interval '1 minute'");

  const remote = {
    reconcileExistingRun: async (): Promise<ReconciledRemoteRun> => ({ kind: "approval", toolName: TOOL, argsSummary: "{\"command\":\"python3 render-office.py\"}" }),
  };
  const recovery = new PgRunRecovery(db, repo, remote, undefined, undefined, grants);
  expect(await recovery.tick(org), "前置：这条 run 必须真的被恢复流程捞起，否则下面断言的是空气").toBe(1);

  const row = await runRow();
  expect(
    row.status,
    "用户已经选过「本 run 内都允许」，恢复流程不该无视授权存储把同一个工具再问一遍",
  ).not.toBe("awaiting_tool_permission");
  expect(row.status, "已授权 ⇒ 重新入队继续跑").toBe("queued");
  expect(row.pending_decision).toBe("approve");
});
