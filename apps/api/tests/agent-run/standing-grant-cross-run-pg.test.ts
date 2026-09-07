import { beforeAll, beforeEach, expect, it } from "vitest";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
const ORG = "org-standing-cross-run", OTHER = "org-standing-cross-run-other";
const org = toOrgId(ORG);
const db: DatabasePort = { withTenant: (id, fn) => asApp(id, c => fn({ query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }) })), withoutTenant: async () => { throw new Error("tenant required"); }, close: async () => {} };
const reader = new PgParentRunControlReader(db);
const check = { orgId: org, parentRunId: "standing-first", leaseEpoch: 2, attemptId: "standing-first:1", toolName: "read_file" };
beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "standing-project" });
  await seedOrg({ orgId: OTHER, projectId: "standing-other-project" });
  await addChatThread({ orgId: ORG, id: "standing-parent-thread", projectId: null, visibilityScope: "plenary", createdBy: "standing-parent-user" });
  await addChatMessage({ orgId: ORG, id: "standing-parent-input", threadId: "standing-parent-thread", body: "run", authorId: "standing-parent-user" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('standing-parent-agent',$1,'standing-parent-agent','standing-parent-agent','enabled','standing-parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('standing-parent-version',$1,'standing-parent-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'standing-parent-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('standing-first',$1,'standing-parent-thread','standing-parent-input','standing-parent-agent','standing-parent-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES('standing-parent-context',$1,'standing-first',2,'context_built','succeeded',now(),now())`, [ORG]);
  });
});

it("real forever decision authorizes a second run only within org/tool scope, with deny taking priority", async () => {
  const { PgAgentRunRepository } = await import("../../src/infrastructure/agent-run/pg-agent-run-repository");
  const { PgToolPermissionGrantRepository } = await import("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository");
  const { ToolExecutionAuthority } = await import("../../src/application/agent-run/tool-execution-authority");
  const { toolArgumentsDigest } = await import("../../src/application/agent-run/tool-arguments-digest");
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  const authority = new ToolExecutionAuthority(reader, repo, grants);
  const first = { ...check, toolName: "external_write", toolArgs: { target: "approved" } };
  expect(await authority.check(first)).toEqual({ allowed: false, reason: "approval_required" });
  await repo.markAwaitingToolPermission(org, "standing-first", { toolName: "external_write", argsSummary: "redacted", toolCallId: "first-call", toolArgsDigest: toolArgumentsDigest(first.toolArgs)! });
  const requestId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='standing-first'", [ORG])).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, "standing-first", requestId, "forever", "standing-parent-user")).toBe(true);
  await addChatThread({ orgId: ORG, id: "standing-second-thread", projectId: null, visibilityScope: "plenary", createdBy: "standing-parent-user" });
  await addChatMessage({ orgId: ORG, id: "standing-second-input", threadId: "standing-second-thread", body: "next run", authorId: "standing-parent-user" });
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('standing-second',$1,'standing-second-thread','standing-second-input','standing-parent-agent','standing-parent-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES('standing-second-context',$1,'standing-second',2,'context_built','succeeded',now(),now())`, [ORG]);
  });
  const second = { ...first, parentRunId: "standing-second", attemptId: "standing-second:1" };
  // Reconstruct both adapters: permission is durable, not a process-local cache.
  const restored = new ToolExecutionAuthority(new PgParentRunControlReader(db), new PgAgentRunRepository(db), new PgToolPermissionGrantRepository(db));
  expect(await restored.check(second)).toEqual({ allowed: true });
  expect(await restored.check({ ...second, toolName: "another_external_write" })).toEqual({ allowed: false, reason: "approval_required" });
  expect(await grants.hasGrant(toOrgId(OTHER), "standing-second", "external_write")).toBe(false);
  expect(await restored.check({ ...second, orgId: toOrgId(OTHER) })).toEqual({ allowed: false, reason: "run_unavailable" });
  await repo.markAwaitingToolPermission(org, "standing-second", { toolName: "external_write", argsSummary: "redacted", toolCallId: "denied-call", toolArgsDigest: toolArgumentsDigest(second.toolArgs)! });
  const deniedId = await asApp(ORG, async c => (await c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='standing-second'", [ORG])).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, "standing-second", deniedId, "deny", "standing-parent-user")).toBe(true);
  await asApp(ORG, c => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id='standing-second'", [ORG]));
  expect(await restored.check({ ...second, toolCallId: "changed-call-id" })).toEqual({ allowed: false, reason: "approval_required" });
  expect(await grants.hasGrant(org, "standing-second", "external_write")).toBe(true);
});
