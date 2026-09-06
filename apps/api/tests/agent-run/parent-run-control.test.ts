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
