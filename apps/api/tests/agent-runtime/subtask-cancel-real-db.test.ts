import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { SUBTASK_RUN_STORE } from "../../src/application/agent-run/subtask-run-queue";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addOrgMember, addProjectMember, asOwner, asApp, ensureDatabase, migrateOnce, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgSubtaskRunStore } from "../../src/infrastructure/agent-run/pg-subtask-run-store";
import { SubtaskRunExecutor } from "../../src/infrastructure/agent-run/subtask-run-executor";
import { SubtaskRunController } from "../../src/interface/controllers/subtask-run.controller";
import type { ModelCallInput } from "../../src/application/agent-run/ports";

// Counterexample: the CI merge shortened the peer main-run deadline to two minutes.
// Derived tasks must still accept their independently bounded 180-second provider.
vi.mock("../../src/application/agent-run/ports", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/application/agent-run/ports")>(),
  DEFAULT_STALE_RUNNING_THRESHOLD_MS: 2 * 60_000,
}));

const suffix = randomUUID();
const org = toOrgId(`org-cancel-${suffix}`), other = toOrgId(`org-cancel-other-${suffix}`);
const parent = `parent-${suffix}`, otherParent = `other-parent-${suffix}`;
let db: PgDatabase;
const logger = { info: () => {}, warn: () => {}, error: () => {} };
async function seed(scope: typeof org, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`, [agent,scope]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','queued')`,
    [id,scope,thread,`message-${scope}`,agent,version]);
  });
}
beforeAll(async () => { await ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  await seed(org,parent); await seed(other,otherParent); }, 120_000);
afterAll(async () => { await db?.close(); });


it("atomic pending cancel competes with claim, stays idempotent and rejects late writes", async () => {
  const store = new PgSubtaskRunStore(db);
  for (let i=0; i<12; i++) {
    const run = await store.enqueue(org,{ parentRunId: parent,description: `race ${i}` });
    const [cancel, claimed] = await Promise.all([store.cancel(org,parent,run.id),new PgSubtaskRunStore(db).claimQueued(org,1)]);
    if (cancel.kind === "cancelled") {
      expect(claimed.some(r => r.id === run.id)).toBe(false);
      expect((await store.cancel(org,parent,run.id)).kind).toBe("cancelled");
      await store.complete(org,run.id,"late"); await store.fail(org,run.id,"late");
      expect((await store.get(org,run.id))?.status).toBe("cancelled");
    } else {
      expect(cancel.kind).toBe("cancellation_not_supported_for_running");
      expect(claimed.map(r => r.id)).toContain(run.id);
      await store.complete(org,run.id,"done");
      expect((await store.cancel(org,parent,run.id)).kind).toBe("terminal_conflict");
    }
  }
  const foreign = await store.enqueue(other,{parentRunId:otherParent,description:"foreign"});
  expect((await store.cancel(org,otherParent,foreign.id)).kind).toBe("not_found");
  expect((await store.cancel(other,parent,foreign.id)).kind).toBe("not_found");
  expect((await store.get(other,foreign.id))?.status).toBe("pending");
});

it("real HTTP cancellation requires parent visibility/write permission and is idempotent", async () => {
  const env = { KERNEL_AGENT_RUN_AUTOSTART:"0",KERNEL_QUIET:"1",KERNEL_ALLOW_TEST_PRINCIPAL:"1" };
  const old = Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])); Object.assign(process.env,env);
  const app = await (await import("../../src/main")).createApp();
  try {
    await app.listen(0,"127.0.0.1");
    const port = (app.getHttpServer().address() as {port:number}).port;
    const store = app.get<PgSubtaskRunStore>(SUBTASK_RUN_STORE);
    const run = await store.enqueue(org,{parentRunId:parent,description:"http cancel"});
    const call = (user: string, scope=org, parentId=parent, childId=run.id) => fetch(`http://127.0.0.1:${port}/agent-runs/${parentId}/subtask-runs/${childId}/cancel`,
      {method:"POST",headers:{"x-kernel-test-principal":`${user}:${scope}`}});
    expect((await call("intruder")).status).toBe(404);
    expect((await call("actor",other,otherParent)).status).toBe(404);
    const responses = await Promise.all([call("actor"),call("actor")]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    for (const response of responses) expect(await response.json()).toMatchObject({subtaskRun:{id:run.id,status:"cancelled"}});
    await store.complete(org,run.id,"late"); expect((await store.get(org,run.id))?.status).toBe("cancelled");
    const running = await store.enqueue(org,{parentRunId:parent,description:"running cannot cancel"});
    await store.claimQueued(org,1);
    const busy = await call("actor",org,parent,running.id);
    expect(busy.status).toBe(409); expect(await busy.json()).toMatchObject({reasonCode:"cancellation_not_supported_for_running"});
    await store.fail(org,running.id,"failed");
    const terminal = await call("actor",org,parent,running.id);
    expect(terminal.status).toBe(409); expect(await terminal.json()).toMatchObject({reasonCode:"terminal_conflict"});
    await addProjectMember(org,`project-${org}`,"actor","observer",null);
    await asApp(org,c=>c.query("UPDATE chat_threads SET project_id=$2,visibility_scope='plenary' WHERE id=$1",[`thread-${org}`,`project-${org}`]));
    expect((await call("actor")).status).toBe(403);
    await asApp(org,c=>c.query("UPDATE chat_threads SET project_id=NULL,visibility_scope='private' WHERE id=$1",[`thread-${org}`]));
    await asApp(org,c=>c.query("UPDATE chat_threads SET archived=true WHERE id=$1",[`thread-${org}`]));
    expect((await call("actor")).status).toBe(403);
  } finally { await app.close(); for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;} }
});

it("cancel migration replays without removing RLS or tenant policy", async () => {
  const sql = await readFile(new URL("../../migrations/20260908010000_subtask_pending_cancel.sql",import.meta.url),"utf8");
  await asOwner(async c=> { await c.query(sql); await c.query(sql);
    const state = await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='subtask_runs'::regclass");
    expect(state.rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
    const policies = await c.query("SELECT policyname FROM pg_policies WHERE tablename='subtask_runs'");
    expect(policies.rows.map(r=>r.policyname)).toContain("subtask_runs_tenant");
  });
});
