import { beforeAll, beforeEach, expect, it } from "vitest";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
const ORG = "org-parent-control", OTHER = "org-parent-control-other";
const org = toOrgId(ORG);
const db: DatabasePort = { withTenant: (id, fn) => asApp(id, c => fn({ query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }) })), withoutTenant: async () => { throw new Error("tenant required"); }, close: async () => {} };
const reader = new PgParentRunControlReader(db);
const check = { orgId: org, parentRunId: "parent", leaseEpoch: 2, attemptId: "parent:1", toolName: "read_file" };
beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "parent-project" });
  await seedOrg({ orgId: OTHER, projectId: "parent-other-project" });
  await addChatThread({ orgId: ORG, id: "parent-thread", projectId: null, visibilityScope: "plenary", createdBy: "parent-user" });
  await addChatMessage({ orgId: ORG, id: "parent-input", threadId: "parent-thread", body: "run", authorId: "parent-user" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('parent-agent',$1,'parent-agent','parent-agent','enabled','parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('parent-version',$1,'parent-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('parent',$1,'parent-thread','parent-input','parent-agent','parent-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES('parent-context',$1,'parent',2,'context_built','succeeded',now(),now())`, [ORG]);
  });
});
it("reads current real context attempt and rejects other tenants, epochs, expired leases", async () => {
  expect(await reader.withSnapshot(check, async s => s)).toMatchObject({ active: true, leaseValid: true, attemptId: "parent:1" });
  expect(await reader.withSnapshot({ ...check, orgId: toOrgId(OTHER) }, async s => s)).toBeNull();
  expect(await reader.withSnapshot({ ...check, leaseEpoch: 1 }, async s => s?.leaseValid)).toBe(false);
  await asApp(ORG, c => c.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 second' WHERE org_id=$1 AND id='parent'", [ORG]));
  expect(await reader.withSnapshot(check, async s => s?.leaseValid)).toBe(false);
});
it("uses durable first cancel identity across readers without leaking cross tenant facts", async () => {
  expect(await reader.readCancellation(org, "parent")).toBeNull();
  await asApp(ORG, c => c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id='parent'", [ORG]));
  const first = await reader.readCancellation(org, "parent");
  expect(first?.requestId).toHaveLength(64);
  expect(await new PgParentRunControlReader(db).readCancellation(org, "parent")).toEqual(first);
  expect(await reader.readCancellation(toOrgId(OTHER), "parent")).toBeNull();
  expect(await reader.withSnapshot(check, async s => s?.cancelRequested)).toBe(true);
});
it("does not accept context from a previous claim as the current attempt", async () => {
  await asApp(ORG, c => c.query("UPDATE agent_runs SET started_at=now()+interval '1 second' WHERE org_id=$1 AND id='parent'", [ORG]));
  expect(await reader.withSnapshot(check, async s => s?.attemptId)).toBeNull();
});

it("binds once permission to real call, args and attempt; repeats are idempotent but other identities are refused", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, "parent", {toolName: "external_write", argsSummary: "redacted", toolCallId: "call-actual", toolArgsDigest: toolArgumentsDigest({target: "original"})!});
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='parent'", [ORG])).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, "parent", requestId, "once", "parent-user")).toBe(true);
  await asApp(ORG, async c => {
    await c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id='parent'", [ORG]);
  });
  const exact = {...check, toolName: "external_write", permissionRequestId: requestId, toolCallId: "call-actual", toolArgs: {target: "original"}};
  const allowed = (value: typeof exact) => reader.withSnapshot(value, async s => await s?.authorizeOnce?.() ?? false);
  expect(await allowed({...exact, toolCallId: "other-call"})).toBe(false);
  expect(await allowed({...exact, toolArgs: {target: "different"}})).toBe(false);
  expect(await allowed({...exact, permissionRequestId: "00000000-0000-4000-8000-000000000000"})).toBe(false);
  expect(await allowed(exact)).toBe(true);
  expect(await allowed(exact)).toBe(true);
  expect(await allowed({...exact, attemptId: "parent:4"})).toBe(false);
  expect(await reader.withSnapshot({...exact, orgId: toOrgId(OTHER)}, async s => s)).toBeNull();
});
it("edited approval accepts only the explicitly edited arguments", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, "parent", {toolName: "external_write", argsSummary: "redacted", toolCallId: "call-edit", toolArgsDigest: toolArgumentsDigest({target: "old"})!});
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='parent'", [ORG])).rows[0].pending_permission_request_id as string);
  await repo.decidePermissionRequest(org, "parent", requestId, "edit", "parent-user", JSON.stringify({target: "new"}));
  await asApp(ORG, c => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id='parent'", [ORG]));
  const exact = {...check, toolName: "external_write", permissionRequestId: requestId, toolCallId: "call-edit", toolArgs: {target: "old"}};
  expect(await reader.withSnapshot(exact, async s => s?.authorizeOnce?.())).toBe(false);
  expect(await reader.withSnapshot({...exact, toolArgs: {target: "new"}}, async s => s?.authorizeOnce?.())).toBe(true);
});
it("explicit denial beats existing grant even when call identity is omitted or changed",async()=>{
  const { ToolExecutionAuthority }=await import("../../src/application/agent-run/tool-execution-authority");
  const { createInMemoryToolPermissionGrantStore }=await import("../../src/application/agent-run/tool-permission-grants");
  const { toolArgumentsDigest }=await import("../../src/application/agent-run/tool-arguments-digest");
  await asApp(ORG,c=>c.query("UPDATE agent_runs SET pending_decision='deny',pending_tool_name='external_write',pending_tool_call_id='denied',pending_tool_args_digest=$2 WHERE org_id=$1 AND id='parent'",[ORG,toolArgumentsDigest({target:"rejected"})]));
  const grants=createInMemoryToolPermissionGrantStore();await grants.grantForRun(org,"parent","external_write");
  const authority=new ToolExecutionAuthority(reader,{readPinnedSkills:async()=>[]},grants);
  const request={...check,toolName:"external_write",toolArgs:{target:"rejected"}};
  expect(await authority.check(request)).toEqual({allowed:false,reason:"approval_required"});
  expect(await authority.check({...request,toolCallId:"new-id"})).toEqual({allowed:false,reason:"approval_required"});
  expect(await authority.check({...request,toolCallId:"new-id",toolArgs:{target:"different"}})).toEqual({allowed:true});
});
