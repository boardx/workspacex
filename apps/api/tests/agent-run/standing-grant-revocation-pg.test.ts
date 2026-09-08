/**
 * issue #3068 —— 「以后都允许」的撤销路径，真库反证。
 *
 * 兄弟文件 `standing-grant-cross-run-pg.test.ts` 证的是"授权真的跨 run 生效"；这里证的
 * 是它**收得回来**——在本 issue 之前，`ToolPermissionGrantStore` 只有 `revokeAllForRun`
 * （run 档），组织级那一档一旦写下就没有任何端点或界面能删掉它，而
 * `tool-permission-card.tsx` 告诉用户"可在下次弹出时改选拒绝以撤销"，可那个弹层再也
 * 不会出现。
 *
 * 走真库而不是内存替身，因为这条路径上有两件**只有真库会说话**的事：
 *   ① F06 的迁移末尾逐字写着「没有 UPDATE/DELETE 授权即是这个纪律在权限层面的落地」，
 *      `GRANT DELETE` 补上之前，`DELETE` 在真库上抛 permission denied，内存替身永远绿；
 *   ② 撤销留痕（`tool_permission_revocations`）是一次同事务 INSERT，替身里不存在。
 */
import { beforeAll, beforeEach, expect, it } from "vitest";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const ORG = "org-standing-revoke", OTHER = "org-standing-revoke-other";
const org = toOrgId(ORG);
const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, c => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};
const reader = new PgParentRunControlReader(db);
const USER = "standing-revoke-user";

async function seedRun(id: string, threadId: string, messageId: string): Promise<void> {
  await addChatThread({ orgId: ORG, id: threadId, projectId: null, visibilityScope: "plenary", createdBy: USER });
  await addChatMessage({ orgId: ORG, id: messageId, threadId, body: "run", authorId: USER });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($2,$1,$3,$4,'standing-revoke-agent','standing-revoke-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG, id, threadId, messageId]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($2||'-context',$1,$2,2,'context_built','succeeded',now(),now())`, [ORG, id]);
  });
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "standing-revoke-project" });
  await seedOrg({ orgId: OTHER, projectId: "standing-revoke-other-project" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('standing-revoke-agent',$1,'standing-revoke-agent','standing-revoke-agent','enabled',$2,now(),now())`, [ORG, USER]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('standing-revoke-version',$1,'standing-revoke-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,$2,now(),now())`, [ORG, USER]);
  });
  await seedRun("standing-revoke-first", "standing-revoke-thread-1", "standing-revoke-input-1");
});

it("授一条 forever → 下一条 run 自动放行 → 撤销 → 再下一条 run 重新要审批", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { PgToolPermissionGrantRepository } = await import("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository");
  const { ToolExecutionAuthority } = await import("../../src/application/agent-run/tool-execution-authority");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  const authority = new ToolExecutionAuthority(reader, repo, grants);
  const toolArgs = { target: "approved" };
  const first = { orgId: org, parentRunId: "standing-revoke-first", leaseEpoch: 2, attemptId: "standing-revoke-first:1", toolName: "external_write", toolArgs };

  // ① 起点：没有任何授权，工具调用要人表态。
  expect(await authority.check(first)).toEqual({ allowed: false, reason: "approval_required" });
  expect(await grants.listStanding(org)).toEqual([]);

  // ② 人点了「以后都允许」。
  await repo.markAwaitingToolPermission(org, "standing-revoke-first", { toolName: "external_write", argsSummary: "redacted", toolCallId: "first-call", toolArgsDigest: toolArgumentsDigest(toolArgs)! });
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='standing-revoke-first'", [ORG])).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, "standing-revoke-first", requestId, "forever", USER)).toBe(true);

  // ③ 这条授权现在**看得见**——在本 issue 之前，它只存在于表里、没有任何读它的路径。
  const listed = await grants.listStanding(org);
  expect(listed).toHaveLength(1);
  expect(listed[0]!.toolName).toBe("external_write");
  expect(listed[0]!.grantedByUserId).toBe(USER);
  expect(listed[0]!.grantId).toBeTruthy();
  // 另一个组织看不到它（RLS + org_id 谓词，两层都在）。
  expect(await grants.listStanding(toOrgId(OTHER))).toEqual([]);

  // ④ 下一条 run 被自动放行——这正是"点一次就再也不问"的那条行为。
  await seedRun("standing-revoke-second", "standing-revoke-thread-2", "standing-revoke-input-2");
  const second = { ...first, parentRunId: "standing-revoke-second", attemptId: "standing-revoke-second:1" };
  const restored = new ToolExecutionAuthority(new PgParentRunControlReader(db), new PgAgentRunRepository(db), new PgToolPermissionGrantRepository(db));
  expect(await restored.check(second)).toEqual({ allowed: true });

  // ⑤ 撤销。
  expect(await grants.revokeStanding(org, listed[0]!.grantId, "standing-revoke-admin")).toBe(true);
  expect(await grants.listStanding(org)).toEqual([]);

  // ⑥ 再下一条 run 重新要审批——撤销真的把放行收回去了，不是只把列表里那行藏起来。
  await seedRun("standing-revoke-third", "standing-revoke-thread-3", "standing-revoke-input-3");
  const third = { ...first, parentRunId: "standing-revoke-third", attemptId: "standing-revoke-third:1" };
  const afterRevoke = new ToolExecutionAuthority(new PgParentRunControlReader(db), new PgAgentRunRepository(db), new PgToolPermissionGrantRepository(db));
  expect(await afterRevoke.check(third)).toEqual({ allowed: false, reason: "approval_required" });

  // ⑦ 撤销不是把历史抹掉：append-only 留痕记下谁撤的、那条当初是谁批的。
  const trail = await asApp(ORG, async c => (await c.query(
    "SELECT grant_id, tool_name, granted_by_user_id, revoked_by_user_id FROM tool_permission_revocations WHERE org_id=$1", [ORG])).rows);
  expect(trail).toHaveLength(1);
  expect(trail[0]).toMatchObject({
    grant_id: listed[0]!.grantId, tool_name: "external_write",
    granted_by_user_id: USER, revoked_by_user_id: "standing-revoke-admin",
  });

  // ⑧ 幂等/并发：第二次撤同一条什么也没删到，如实回 false，且不补写第二条留痕。
  expect(await grants.revokeStanding(org, listed[0]!.grantId, "standing-revoke-admin")).toBe(false);
  expect(await asApp(ORG, async c => (await c.query(
    "SELECT count(*)::int AS n FROM tool_permission_revocations WHERE org_id=$1", [ORG])).rows[0].n)).toBe(1);
});

it("撤销不能跨组织，也不能借 forever 的口撤掉 run 档的行", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { PgToolPermissionGrantRepository } = await import("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository");
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);

  await grants.grantForRun(org, "standing-revoke-first", "run_scoped_tool");
  const runGrantId = await asApp(ORG, async c => (await c.query(
    "SELECT id FROM tool_permission_grants WHERE org_id=$1 AND scope='run'", [ORG])).rows[0].id as string);

  // `scope='forever'` 谓词是承重的：没有它，run 档的行也能从这条路径删掉，
  // 等于给「本 run 内都允许」开了第二条与 revokeAllForRun 语义不同的撤销口。
  expect(await grants.revokeStanding(org, runGrantId, "standing-revoke-admin")).toBe(false);
  expect(await grants.hasGrant(org, "standing-revoke-first", "run_scoped_tool")).toBe(true);

  await grants.grantStanding(org, "cross_org_tool", USER);
  const [row] = await grants.listStanding(org);
  // 另一个组织拿着同一个 grantId 也撤不动（withTenant 的 RLS + org_id 谓词）。
  expect(await grants.revokeStanding(toOrgId(OTHER), row!.grantId, "outsider")).toBe(false);
  expect(await grants.listStanding(org)).toHaveLength(1);
  expect(repo).toBeTruthy();
});

it("F11 的 revokeAllForRun 在真库上真的删得掉——补 GRANT DELETE 之前它必然 permission denied", async () => {
  const { PgToolPermissionGrantRepository } = await import("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository");
  const grants = new PgToolPermissionGrantRepository(db);
  await grants.grantForRun(org, "standing-revoke-first", "direction_sensitive_tool");
  expect(await grants.hasGrant(org, "standing-revoke-first", "direction_sensitive_tool")).toBe(true);
  // 这条路径此前只有内存替身覆盖过——app_rw 从来没有 DELETE 权限，真库上一定抛
  // `permission denied for table tool_permission_grants`，没有任何门控看见过。
  await grants.revokeAllForRun(org, "standing-revoke-first");
  expect(await grants.hasGrant(org, "standing-revoke-first", "direction_sensitive_tool")).toBe(false);
});
