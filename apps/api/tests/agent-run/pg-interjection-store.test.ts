import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PgInterjectionStore } from "../../src/infrastructure/agent-run/pg-interjection-store";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const ORG = "org-workbench-interjections";
const OTHER = "org-workbench-interjections-other";
const db: DatabasePort = {
  withTenant: (org, fn) => asApp(org, (c) => fn({ query: async (sql, params = []) => {
    const result = await c.query(sql, [...params]);
    return { rows: result.rows };
  } })),
  withoutTenant: async () => { throw new Error("tenant required"); }, close: async () => {},
};
const queue = new PgInterjectionStore(db);
const org = toOrgId(ORG);
const pending = (id: string) => ({ interjectionId: id, text: id, receivedAt: "2026-09-07T00:00:00Z" });

async function seedRun(tenant: string, run: string) {
  const actor = `${tenant}-user`, agent = `${tenant}-agent`, version = `${agent}-v1`, thread = `${run}-thread`;
  await addChatThread({ orgId: tenant, id: thread, projectId: `${tenant}-project`, createdBy: actor, visibilityScope: "plenary" });
  await addChatMessage({ orgId: tenant, id: `${run}-message`, threadId: thread, body: "task", authorId: actor });
  await asApp(tenant, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$1,$1,'enabled',$3,now(),now()) ON CONFLICT DO NOTHING`, [agent, tenant, actor]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
      model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,$1,$4,'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,$5,now(),now()) ON CONFLICT DO NOTHING`,
    [version, tenant, agent, createHash("sha256").update("test").digest("hex"), actor]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status)
      VALUES($1,$2,$3,$4,$5,$6,'[]','deep-agent','deep-agent','running')`, [run, tenant, thread, `${run}-message`, agent, version]);
  });
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  for (const tenant of [ORG, OTHER]) {
    await seedOrg({ orgId: tenant, projectId: `${tenant}-project` });
    await addOrgMember(tenant, `${tenant}-user`, "consultant", null);
  }
  await seedRun(ORG, "queue-run-a");
  await seedRun(ORG, "queue-run-b");
  await seedRun(OTHER, "queue-run-other");
});

describe("durable workbench input", () => {
  it("retains FIFO inputs across repeated delivery and repository restart until acknowledged", async () => {
    await queue.submit(org, "queue-run-a", pending("first"));
    await queue.submit(org, "queue-run-a", pending("second"));
    await queue.submit(org, "queue-run-a", pending("first"));
    expect((await queue.pollForKernel(org, "queue-run-a", [])).map(v => v.interjectionId)).toEqual(["first", "second"]);
    const restarted = new PgInterjectionStore(db);
    expect((await restarted.pollForKernel(org, "queue-run-a", [])).map(v => v.interjectionId)).toEqual(["first", "second"]);
    expect((await restarted.pollForKernel(org, "queue-run-a", ["first"])).map(v => v.interjectionId)).toEqual(["second"]);
    expect(await restarted.pollForKernel(org, "queue-run-a", ["second"])).toEqual([]);
    expect(await queue.pollForKernel(org, "queue-run-a", [])).toEqual([]);
  });

  it("cannot read, acknowledge, or submit into a different tenant/run", async () => {
    await queue.submit(org, "queue-run-a", pending("one"));
    expect(await queue.pollForKernel(toOrgId(OTHER), "queue-run-a", ["one"])).toEqual([]);
    expect(await queue.pollForKernel(org, "queue-run-b", ["one"])).toEqual([]);
    await expect(queue.submit(toOrgId(OTHER), "queue-run-a", pending("attack"))).rejects.toThrow("not_running");
    expect((await queue.pollForKernel(org, "queue-run-a", [])).map(v => v.interjectionId)).toEqual(["one"]);
  });

  it("records pause intent without claiming the run has paused", async () => {
    expect(await queue.requestPause(org, "queue-run-a")).toBe(true);
    expect(await queue.isPauseRequested(org, "queue-run-a")).toBe(true);
    expect(await queue.requestPause(toOrgId(OTHER), "queue-run-a")).toBe(false);
    const state = await asApp(ORG, c => c.query("SELECT status,paused_at FROM agent_runs WHERE id=$1", ["queue-run-a"]));
    expect(state.rows[0]).toEqual({ status: "running", paused_at: null });
  });
});
