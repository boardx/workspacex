import { createServer } from "node:http";
import { SUBTASK_RUN_STORE } from "../../src/application/agent-run/subtask-run-queue";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgSubtaskRunStore } from "../../src/infrastructure/agent-run/pg-subtask-run-store";
import { SubtaskRunExecutor } from "../../src/infrastructure/agent-run/subtask-run-executor";
import { SubtaskRunController } from "../../src/interface/controllers/subtask-run.controller";
import type { ModelCallInput } from "../../src/application/agent-run/ports";

const suffix = randomUUID();
const org = toOrgId(`org-t042-${suffix}`), other = toOrgId(`org-t042-other-${suffix}`);
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

describe("WX-T042 durable queue", () => {
  it("survives adapter restart and claims each job once across competing workers", async () => {
    const first = new PgSubtaskRunStore(db);
    const jobs = await Promise.all(Array.from({ length: 8 }, (_, i) => first.enqueue(org, { parentRunId: parent, description: `job ${i}` })));
    const restarted = new PgSubtaskRunStore(db);
    expect((await restarted.listByParentRun(org,parent)).map(r => r.id).sort()).toEqual(jobs.map(r => r.id).sort());
    const claims = (await Promise.all([first.claimQueued(org,5), restarted.claimQueued(org,5)])).flat();
    expect(new Set(claims.map(r => r.id)).size).toBe(8);
    expect(claims).toHaveLength(8);
    for (const run of claims) await restarted.complete(org,run.id,"done");
    await restarted.complete(org,jobs[0]!.id,"overwrite");
    await restarted.fail(org,jobs[0]!.id,"late failure");
    expect((await new PgSubtaskRunStore(db).get(org,jobs[0]!.id))?.result).toBe("done");
  });
  it("enforces organization ownership on reads, writes and parent foreign keys", async () => {
    const store = new PgSubtaskRunStore(db);
    const foreign = await store.enqueue(other,{ parentRunId: otherParent, description: "private" });
    expect(await store.get(org,foreign.id)).toBeNull();
    expect(await store.listByParentRun(org,otherParent)).toEqual([]);
    expect(await store.claimQueued(org,20)).toEqual([]);
    await store.complete(org,foreign.id,"attack");
    expect((await store.get(other,foreign.id))?.status).toBe("pending");
    await expect(store.enqueue(org,{ parentRunId: otherParent, description: "cross-org" })).rejects.toThrow();
    const hidden = await db.withTenant(org,s => s.query("SELECT id FROM subtask_runs WHERE id=$1",[foreign.id]));
    expect(hidden.rows).toEqual([]);
  });
  it("marks lost running work failed on a later kick without replaying it or accepting stale completion", async () => {
    const store = new PgSubtaskRunStore(db);
    const run = await store.enqueue(org,{ parentRunId: parent, description: "interrupted" });
    await store.claimQueued(org,1);
    await asApp(org,c => c.query("UPDATE subtask_runs SET updated_at=now()-interval '1 hour' WHERE id=$1",[run.id]));
    expect(await new PgSubtaskRunStore(db).claimQueued(org,10)).toEqual([]);
    await store.complete(org,run.id,"late worker");
    expect(await store.get(org,run.id)).toMatchObject({ status: "failed", result: null, error: "subtask_execution_lost_after_restart_or_timeout" });
    const retried = await store.enqueue(org,{ parentRunId: parent, description: "interrupted" });
    expect(retried.id).not.toBe(run.id);
    await store.claimQueued(org,1); await store.complete(org,retried.id,"retry done");
  });
  it("controller submission kicks real model port execution and persists queryable terminal output", async () => {
    const calls: ModelCallInput[] = [];
    const store = new PgSubtaskRunStore(db);
    const executor = new SubtaskRunExecutor(store,db,{ complete: async input => {
      calls.push(input); return { text: "real port result" };
    } },logger,true,new Map([["test-provider",180_000]]));
    const controller = new SubtaskRunController(store,executor);
    const old = process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
    process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = "t042-key";
    try {
      const result = await controller.enqueue("t042-key",{ orgId: org,parentRunId: parent,description: "summarize",context: "scoped context" });
      expect(result.status).toBe("pending");
      await expect.poll(async () => (await store.get(org,result.subtaskRunId))?.status).toBe("completed");
      expect((await store.get(org,result.subtaskRunId))?.result).toBe("real port result");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ modelProvider: "test-provider",modelId: "pinned-model",system: "pinned instructions",orgId: org,executionMode: "text-only",skills: [] });
      expect(calls[0]!.user).toContain("scoped context");
    } finally { if (old === undefined) delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY; else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = old; }
  });
  it("deduplicates concurrent replay by explicit key and rejects different payload", async () => {
    const store = new PgSubtaskRunStore(db);
    const input = { parentRunId: parent,description: "idempotent task",context: "context",idempotencyKey: "call-42" };
    const results = await Promise.all([store.enqueue(org,input),new PgSubtaskRunStore(db).enqueue(org,input)]);
    expect(results[0]!.id).toBe(results[1]!.id);
    await expect(store.enqueue(org,{ ...input,description: "different" })).rejects.toThrow("subtask_idempotency_conflict");
    await expect(store.enqueue(org,{ ...input,context: null })).rejects.toThrow("subtask_idempotency_conflict");
    const foreign = await store.enqueue(other,{ ...input,parentRunId: otherParent });
    expect(foreign.id).not.toBe(results[0]!.id);
    await store.claimQueued(org,1); await store.complete(org,results[0]!.id,"done");
  });
  it("refuses unsupported or excessively long model deadlines before invoking the model", async () => {
    const store = new PgSubtaskRunStore(db);
    const run = await store.enqueue(org,{ parentRunId: parent,description: "long unsupported" });
    let calls = 0;
    const executor = new SubtaskRunExecutor(store,db,{ complete: async () => { calls++; return { text: "unexpected" }; } },
      logger,false,new Map([["test-provider",20 * 60_000]]));
    await executor.tick(org);
    expect(calls).toBe(0);
    expect(await store.get(org,run.id)).toMatchObject({ status: "failed",error: "subtask_provider_timeout_or_execution_mode_unsupported" });
  });
  it("production DI and HTTP enqueue reach a real loopback model and durable terminal state", async () => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((req,res) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(200,{ "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "HTTP model completed" } }] }));
      });
    });
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    const address = server.address() as { port: number };
    const env = { KERNEL_MODEL_PROVIDER: "test-provider", KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${address.port}`,
      KERNEL_MODEL_API_KEY: "test-key", DEEP_AGENT_SERVICE_INTERNAL_KEY: "t042-http-key",
      KERNEL_AGENT_RUN_AUTOSTART: "1", KERNEL_QUIET: "1", KERNEL_ALLOW_TEST_PRINCIPAL: "1" };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key,process.env[key]]));
    Object.assign(process.env,env);
    let app: Awaited<ReturnType<typeof import("../../src/main")["createApp"]>> | undefined;
    try {
      app = await (await import("../../src/main")).createApp();
      await app.listen(0,"127.0.0.1");
      const port = (app.getHttpServer().address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/internal/subtask-runs`, {
        method: "POST", headers: { "content-type": "application/json", "x-deep-agent-internal-key": "t042-http-key" },
        body: JSON.stringify({ orgId: org,parentRunId: parent,description: "HTTP child" }),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { subtaskRunId: string };
      const durable = app.get<PgSubtaskRunStore>(SUBTASK_RUN_STORE);
      expect(durable).toBeInstanceOf(PgSubtaskRunStore);
      await expect.poll(async () => (await durable.get(org,body.subtaskRunId))?.status).toBe("completed");
      expect((await durable.get(org,body.subtaskRunId))?.result).toBe("HTTP model completed");
      expect(requests).toHaveLength(1);
      expect(requests[0]!.model).toBe("pinned-model");
      expect(requests[0]).not.toHaveProperty("tools");
      const url = `http://127.0.0.1:${port}/agent-runs/${parent}/subtask-runs`;
      const headers = (user: string) => ({ "x-kernel-test-principal": `${user}:${org}` });
      expect((await fetch(url,{ headers: headers("actor") })).status).toBe(200);
      expect((await fetch(url,{ headers: headers("intruder") })).status).toBe(404);
      expect((await fetch(`${url}/${body.subtaskRunId}/retry`,{ method: "POST",headers: headers("actor") })).status).toBe(409);
      const failed = await durable.enqueue(org,{ parentRunId: parent,description: "retry private" });
      await durable.claimQueued(org,1); await durable.fail(org,failed.id,"fixture failed");
      expect((await fetch(`${url}/${failed.id}/retry`,{ method: "POST",headers: headers("intruder") })).status).toBe(404);
      expect(requests).toHaveLength(1);
      const retries = await Promise.all([0,1].map(() => fetch(`${url}/${failed.id}/retry`,{ method: "POST",headers: headers("actor") })));
      expect(retries.map(r => r.status)).toEqual([201,201]);
      const retryBodies = await Promise.all(retries.map(r => r.json())) as { subtaskRunId: string }[];
      expect(retryBodies[0]!.subtaskRunId).toBe(retryBodies[1]!.subtaskRunId);
      const retryBody = retryBodies[0]!;
      expect(retryBody.subtaskRunId).not.toBe(failed.id);
      await expect.poll(async () => (await durable.get(org,retryBody.subtaskRunId))?.status).toBe("completed");
      expect(requests).toHaveLength(2);
    } finally {
      await app?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

});
