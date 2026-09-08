import { beforeAll, beforeEach, expect, it } from "vitest";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { randomUUID } from "node:crypto";
/*
 * #2989: `agent_runs.id` -- and `agents` / `agent_versions` / `agent_run_steps` / `subtask_runs`.id --
 * are GLOBAL primary keys; `org_id` is not part of them. A hardcoded fixture id therefore collides
 * with any other test file that picks the same literal, however different the orgs, and the loser
 * dies in beforeEach with `duplicate key`. Which file loses is decided by vitest scheduling, so it
 * reads like a flake while the conflict itself is deterministic. Every id this file writes is
 * suffixed per process run.
 */
const UID = randomUUID();
const uid = (name: string) => `${name}-${UID}`;
const RUN = uid("parent"), AGENT = uid("parent-agent"), VERSION = uid("parent-version");
const THREAD = uid("parent-thread"), INPUT = uid("parent-input"), STEP = uid("parent-context");
const ORG = "org-parent-control", OTHER = "org-parent-control-other";
const org = toOrgId(ORG);
const db: DatabasePort = { withTenant: (id, fn) => asApp(id, c => fn({ query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }) })), withoutTenant: async () => { throw new Error("tenant required"); }, close: async () => {} };
const reader = new PgParentRunControlReader(db);
const check = { orgId: org, parentRunId: RUN, leaseEpoch: 2, attemptId: `${RUN}:1`, toolName: "read_file" };
beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "parent-project" });
  await seedOrg({ orgId: OTHER, projectId: "parent-other-project" });
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, visibilityScope: "plenary", createdBy: "parent-user" });
  await addChatMessage({ orgId: ORG, id: INPUT, threadId: THREAD, body: "run", authorId: "parent-user" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($2,$1,'parent-agent','parent-agent','enabled','parent-user',now(),now())`, [ORG, AGENT]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($2,$1,$3,'v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'parent-user',now(),now())`, [ORG, VERSION, AGENT]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($2,$1,$3,$4,$5,$6,'[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG, RUN, THREAD, INPUT, AGENT, VERSION]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($2,$1,$3,2,'context_built','succeeded',now(),now())`, [ORG, STEP, RUN]);
  });
});
it("reads current real context attempt and rejects other tenants, epochs, expired leases", async () => {
  expect(await reader.withSnapshot(check, async s => s)).toMatchObject({ active: true, leaseValid: true, attemptId: `${RUN}:1` });
  expect(await reader.withSnapshot({ ...check, orgId: toOrgId(OTHER) }, async s => s)).toBeNull();
  expect(await reader.withSnapshot({ ...check, leaseEpoch: 1 }, async s => s?.leaseValid)).toBe(false);
  await asApp(ORG, c => c.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect(await reader.withSnapshot(check, async s => s?.leaseValid)).toBe(false);
});
it("uses durable first cancel identity across readers without leaking cross tenant facts", async () => {
  expect(await reader.readCancellation(org, RUN)).toBeNull();
  await asApp(ORG, c => c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  const first = await reader.readCancellation(org, RUN);
  expect(first?.requestId).toHaveLength(64);
  expect(await new PgParentRunControlReader(db).readCancellation(org, RUN)).toEqual(first);
  expect(await reader.readCancellation(toOrgId(OTHER), RUN)).toBeNull();
  expect(await reader.withSnapshot(check, async s => s?.cancelRequested)).toBe(true);
});
it("does not accept context from a previous claim as the current attempt", async () => {
  await asApp(ORG, c => c.query("UPDATE agent_runs SET started_at=now()+interval '1 second' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect(await reader.withSnapshot(check, async s => s?.attemptId)).toBeNull();
});

it("binds once permission to real call, args and attempt; repeats are idempotent but other identities are refused", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, RUN, {toolName: "external_write", argsSummary: "redacted", toolCallId: "call-actual", toolArgsDigest: toolArgumentsDigest({target: "original"})!});
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN])).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "once", "parent-user")).toBe(true);
  await asApp(ORG, async c => {
    await c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]);
  });
  const exact = {...check, toolName: "external_write", permissionRequestId: requestId, toolCallId: "call-actual", toolArgs: {target: "original"}};
  const allowed = (value: typeof exact) => reader.withSnapshot(value, async s => await s?.authorizeOnce?.() ?? false);
  expect(await allowed({...exact, toolCallId: "other-call"})).toBe(false);
  expect(await allowed({...exact, toolArgs: {target: "different"}})).toBe(false);
  expect(await allowed({...exact, permissionRequestId: "00000000-0000-4000-8000-000000000000"})).toBe(false);
  expect(await allowed(exact)).toBe(true);
  expect(await allowed(exact)).toBe(true);
  expect(await allowed({...exact, attemptId: `${RUN}:4`})).toBe(false);
  expect(await reader.withSnapshot({...exact, orgId: toOrgId(OTHER)}, async s => s)).toBeNull();
});
it("edited approval accepts only the explicitly edited arguments", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, RUN, {toolName: "external_write", argsSummary: "redacted", toolCallId: "call-edit", toolArgsDigest: toolArgumentsDigest({target: "old"})!});
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN])).rows[0].pending_permission_request_id as string);
  await repo.decidePermissionRequest(org, RUN, requestId, "edit", "parent-user", JSON.stringify({target: "new"}));
  await asApp(ORG, c => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  const exact = {...check, toolName: "external_write", permissionRequestId: requestId, toolCallId: "call-edit", toolArgs: {target: "old"}};
  expect(await reader.withSnapshot(exact, async s => s?.authorizeOnce?.())).toBe(false);
  expect(await reader.withSnapshot({...exact, toolArgs: {target: "new"}}, async s => s?.authorizeOnce?.())).toBe(true);
});
it("explicit denial beats existing grant even when call identity is omitted or changed",async()=>{
  const { ToolExecutionAuthority }=await import("../../src/application/agent-run/tool-execution-authority");
  const { createInMemoryToolPermissionGrantStore }=await import("../../src/application/agent-run/tool-permission-grants");
  const { toolArgumentsDigest }=await import("../../src/application/agent-run/tool-arguments-digest");
  await asApp(ORG,c=>c.query("UPDATE agent_runs SET pending_decision='deny',pending_tool_name='external_write',pending_tool_call_id='denied',pending_tool_args_digest=$2 WHERE org_id=$1 AND id=$3",[ORG,toolArgumentsDigest({target:"rejected"}),RUN]));
  const grants=createInMemoryToolPermissionGrantStore();await grants.grantForRun(org,RUN,"external_write");
  const authority=new ToolExecutionAuthority(reader,{readPinnedSkills:async()=>[]},grants);
  const request={...check,toolName:"external_write",toolArgs:{target:"rejected"}};
  expect(await authority.check(request)).toEqual({allowed:false,reason:"approval_required"});
  expect(await authority.check({...request,toolCallId:"new-id"})).toEqual({allowed:false,reason:"approval_required"});
  expect(await authority.check({...request,toolCallId:"new-id",toolArgs:{target:"different"}})).toEqual({allowed:true});
});

/**
 * #2931 —— 产文件的 durable 子任务要用**自己**的 (run, attempt, lease) 身份走到
 * `wx_artifact_publish`。在此之前 `withSnapshot` 只查 `agent_runs`，子任务 id 查不到
 * ⇒ 直接 `run_unavailable`，真实子模型一次都写不进自己的 staging。
 *
 * 这几条同时钉住反方向：解析到子任务**不等于**把父 run 的工具权限借给它。
 */
/** 与 `subtask_output_policy_shape` 一致的最小合法策略。 */
const FILE_POLICY = { mediaTypes: ["application/pdf"], maxFiles: 1, maxTotalBytes: 1024 };
const seedChild = async (options: { id: string; status?: string; outputPolicy?: unknown; epoch?: number } ) => {
  await asApp(ORG, c => c.query(
    `INSERT INTO subtask_runs(id,org_id,parent_run_id,description,status,created_at,updated_at,
       agent_version_id,skill_version_ids,model_provider,model_id,
       output_policy,lease_epoch,execution_attempt_id)
     VALUES($1,$2,$7,'make a file',$3,now(),now(),
       $8,'[]'::jsonb,'deep-agent','deep-agent',
       $4::jsonb,$5,$6)`,
    [options.id, ORG, options.status ?? "running",
      options.outputPolicy === undefined ? null : JSON.stringify(options.outputPolicy),
      options.epoch ?? 3, `${options.id}:${options.epoch ?? 3}`, RUN, VERSION]));
};
const childCheck = (id: string, toolName = "wx_artifact_publish", epoch = 3) =>
  ({ orgId: org, parentRunId: id, leaseEpoch: epoch, attemptId: `${id}:${epoch}`, toolName });

it("#2931 resolves a file-producing subtask by its own identity, and grants it publish ONLY", async () => {
  await seedChild({ id: uid("child-files"), outputPolicy: FILE_POLICY });
  const snapshot = await reader.withSnapshot(childCheck(uid("child-files")), async s => s);
  expect(snapshot).toMatchObject({ active: true, leaseValid: true, attemptId: `${uid("child-files")}:3` });
  // 唯一被放行的工具就是发布产物那一个——父 run 的其余 native 工具一概不继承。
  expect(snapshot?.allowedTools).toEqual(["wx_artifact_publish"]);
});

it("#2931 a text-only subtask resolves but is allowed NO tool at all", async () => {
  await seedChild({ id: uid("child-text") });
  expect(await reader.withSnapshot(childCheck(uid("child-text")), async s => s?.allowedTools)).toEqual([]);
});

it("#2931 subtask identity is fenced by org, lease epoch, attempt and its own status", async () => {
  await seedChild({ id: uid("child-fenced"), outputPolicy: FILE_POLICY });
  expect(await reader.withSnapshot({ ...childCheck(uid("child-fenced")), orgId: toOrgId(OTHER) }, async s => s)).toBeNull();
  expect(await reader.withSnapshot({ ...childCheck(uid("child-fenced")), leaseEpoch: 2 }, async s => s?.leaseValid)).toBe(false);
  // 晚到的完成不能靠旧 attempt 继续发布。
  await asApp(ORG, c => c.query("UPDATE subtask_runs SET status='completed',result='done' WHERE org_id=$1 AND id=$2", [ORG, uid("child-fenced")]));
  expect(await reader.withSnapshot(childCheck(uid("child-fenced")), async s => s?.active)).toBe(false);
});

it("#2931 cancelling the PARENT stops the child from publishing", async () => {
  await seedChild({ id: uid("child-cancel"), outputPolicy: FILE_POLICY });
  expect(await reader.withSnapshot(childCheck(uid("child-cancel")), async s => s?.cancelRequested)).toBe(false);
  await asApp(ORG, c => c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect(await reader.withSnapshot(childCheck(uid("child-cancel")), async s => s?.cancelRequested)).toBe(true);
});
