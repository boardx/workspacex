import {EXECUTION_MODE_CONFIG_KEY} from "@repo/contracts/standard-capabilities";
import { createServer } from "node:http";
import { SUBTASK_RUN_STORE } from "../../src/application/agent-run/subtask-run-queue";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addOrgMember, asApp,asOwner, ensureDatabase, migrateOnce, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgSubtaskRunStore } from "../../src/infrastructure/agent-run/pg-subtask-run-store";
import { SubtaskRunExecutor } from "../../src/infrastructure/agent-run/subtask-run-executor";
import { SubtaskRunController } from "../../src/interface/controllers/subtask-run.controller";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Counterexample: the CI merge shortened the peer main-run deadline to two minutes.
// Derived tasks must still accept their independently bounded 180-second provider.
vi.mock("../../src/application/agent-run/ports", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/application/agent-run/ports")>(),
  DEFAULT_STALE_RUNNING_THRESHOLD_MS: 2 * 60_000,
}));

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
  it('replays the artifact handoff migration without weakening RLS',async()=>{
    const sql=await readFile(new URL('../../migrations/20260910010000_subtask_artifact_handoff.sql',import.meta.url),'utf8');
    await asOwner(async c=>{await c.query(sql);await c.query(sql);const state=await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='subtask_runs'::regclass");expect(state.rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});});
  });
  it('pins the child snapshot and atomically publishes verified file references',async()=>{
    const scope=toOrgId(`org-artifact-${randomUUID()}`),parentId=`parent-artifact-${randomUUID()}`;await seed(scope,parentId);
    const store=new PgSubtaskRunStore(db),root=await mkdtemp(join(tmpdir(),'t042-artifacts-')),objects=new FsObjectStore(root);
    try{
      const run=await store.enqueue(scope,{parentRunId:parentId,description:'write report',idempotencyKey:'artifact-contract',outputFiles:{mediaTypes:['text/markdown'],maxFiles:1,maxTotalBytes:1024}});
      expect(run.snapshot).toEqual({agentVersionId:`version-${scope}`,skillVersionIds:[],modelProvider:'test-provider',modelId:'pinned-model'});
      await expect(store.enqueue(scope,{parentRunId:parentId,description:'write report',idempotencyKey:'artifact-contract',outputFiles:{mediaTypes:['text/markdown'],maxFiles:1,maxTotalBytes:1024},snapshot:{...run.snapshot,modelId:'changed'}})).rejects.toThrow('subtask_snapshot_changed');
      await store.claimQueued(scope,1);
      await asApp(scope,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now()) ON CONFLICT DO NOTHING",[randomUUID(),scope,parentId]));
      const bytes=Buffer.from('# durable child\n','utf8'),hash=createHash('sha256').update(bytes).digest('hex'),objectKey=`agent-run-outputs/run/${hash}/report.md`;
      await objects.putOnce(objectKey,bytes,'text/markdown');
      await store.completeWithArtifacts(scope,run.id,'report ready',[{name:'report.md',mime:'text/markdown',sizeBytes:bytes.length,objectKey}]);
      const completed=await store.get(scope,run.id);expect(completed).toMatchObject({status:'completed',result:'report ready'});expect(completed?.artifactRefs).toHaveLength(1);
      const version=await db.withTenant(scope,s=>s.query<{storage_key:string}>('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND id=$2',[scope,completed!.artifactRefs[0]!.versionId]));
      const downloaded=await objects.get(version.rows[0]!.storage_key);expect(createHash('sha256').update(downloaded!).digest('hex')).toBe(hash);
      const env={WORKSPACEX_OBJECT_ROOT:root,KERNEL_ALLOW_TEST_PRINCIPAL:'1',KERNEL_QUIET:'1',KERNEL_AGENT_RUN_AUTOSTART:'0'},old=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
      const app=await (await import('../../src/main')).createApp();try{await app.listen(0,'127.0.0.1');const url=`${await app.getUrl()}/artifacts/${completed!.artifactRefs[0]!.artifactId}/versions/1/content`;
        const response=await fetch(url,{headers:{'x-kernel-test-principal':`actor:${scope}`}});expect(response.status).toBe(200);expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(hash);
        expect((await fetch(url,{headers:{'x-kernel-test-principal':`intruder:${scope}`}})).status).toBe(404);expect((await fetch(url,{headers:{'x-kernel-test-principal':`actor:${other}`}})).status).toBe(404);
      }finally{await app.close();for(const[key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
    }finally{await rm(root,{recursive:true,force:true});}
  });
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
      const { CHILD_RUN_CANCELLER } = await import("../../src/application/agent-run/parent-run-control");
      const { PgChildRunCanceller } = await import("../../src/infrastructure/agent-run/pg-child-run-canceller");
      expect(app.get(CHILD_RUN_CANCELLER)).toBeInstanceOf(PgChildRunCanceller);
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
      await asApp(org,c=>c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2",[org,parent]));
      const late = await fetch(`http://127.0.0.1:${port}/internal/subtask-runs`, {
        method:"POST",headers:{"content-type":"application/json","x-deep-agent-internal-key":"t042-http-key"},
        body:JSON.stringify({orgId:org,parentRunId:parent,description:"late authenticated callback"}),
      });
      expect(late.status).toBe(409);
      expect(await late.json()).toMatchObject({reasonCode:"SUBTASK_PARENT_CANCELLED"});
      expect(requests).toHaveLength(2);
      // Restore only this fixture before the independent adapter scenarios below.
      await asApp(org,c=>c.query("UPDATE agent_runs SET cancel_requested_at=NULL WHERE org_id=$1 AND id=$2",[org,parent]));
    } finally {
      await app?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  // issue #3100 D6 —— 工具明细列：迁移可重放、默认空数组、折叠后经 listByParentRun 读回。
  // 反证：把 recordToolCall 的 UPDATE 去掉 ⇒ 本例读回空数组，红。
  it('records engine-reported tool calls on the child row and replays its migration',async()=>{
    const sql=await readFile(new URL('../../migrations/20260911010000_subtask_tool_calls.sql',import.meta.url),'utf8');
    await asOwner(async c=>{await c.query(sql);await c.query(sql);});
    const store=new PgSubtaskRunStore(db);
    const run=await store.enqueue(org,{parentRunId:parent,description:'tool detail'});
    expect(run.toolCalls).toEqual([]);
    await store.recordToolCall(org,run.id,{toolCallId:'t-1',toolName:'web_search',argsSummary:'q',
      resultSummary:null,phase:'in_progress',ok:null,at:'2026-09-08T10:00:00.000Z'});
    await store.recordToolCall(org,run.id,{toolCallId:'t-1',toolName:'web_search',argsSummary:null,
      resultSummary:'8 条',phase:'complete',ok:true,at:'2026-09-08T10:00:01.500Z'});
    const listed=(await store.listByParentRun(org,parent)).find(r=>r.id===run.id)!;
    expect(listed.toolCalls).toEqual([{toolCallId:'t-1',toolName:'web_search',argsSummary:'q',
      resultSummary:'8 条',ok:true,startedAt:'2026-09-08T10:00:00.000Z',durationMs:1500}]);
    // 跨租户不可见：另一个 org 的 store 读不到这条明细。
    expect(await store.listByParentRun(other,parent)).toEqual([]);
    // 不给后续用例留下活跃子任务（它们断言这个父 run 下的 pending/running 集合）。
    expect((await store.cancel(org,parent,run.id)).kind).toBe('cancelled');
  });
});

describe("parent cancellation handshake", () => {
  it("serializes enqueue and claim behind the durable parent cancellation lock", async () => {
    const scope=toOrgId(`org-race-${randomUUID()}`), id=`race-${randomUUID()}`;
    await seed(scope,id);
    const store=new PgSubtaskRunStore(db);
    const pending=await store.enqueue(scope,{parentRunId:id,description:"pending before cancel"});
    let queued: Promise<unknown> | undefined;
    await asApp(scope,async c=>{
      await c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2",[scope,id]);
      queued=store.enqueue(scope,{parentRunId:id,description:"late during transaction"}).catch(error=>error);
      // claim uses SKIP LOCKED parent: it cannot acquire a child behind the cancellation.
      expect(await store.claimQueued(scope,10)).toEqual([]);
    });
    expect(await queued).toBeInstanceOf(Error);
    expect(String(await queued)).toContain("subtask_parent_cancelled");
    expect(await store.claimQueued(scope,10)).toEqual([]);
    expect((await store.get(scope,pending.id))?.status).toBe("cancelled");
  });
  it("uses durable parent identity, rejects late work and reads without mutation", async () => {
    const { PgChildRunCanceller } = await import("../../src/infrastructure/agent-run/pg-child-run-canceller");
    const { parentCancelRequestId } = await import("../../src/application/agent-run/parent-run-control");
    const store = new PgSubtaskRunStore(db);
    const child = await store.enqueue(org,{parentRunId:parent,description:"cancel pending"});
    const running = await store.enqueue(org,{parentRunId:parent,description:"already running"});
    await asApp(org,c=>c.query("UPDATE subtask_runs SET status='running' WHERE org_id=$1 AND id=$2",[org,running.id]));
    const stamp = new Date().toISOString();
    await asApp(org,c=>c.query("UPDATE agent_runs SET cancel_requested_at=$3 WHERE org_id=$1 AND id=$2",[org,parent,stamp]));
    const input={orgId:org,parentRunId:parent,requestId:parentCancelRequestId(org,parent,stamp)};
    const adapter=new PgChildRunCanceller(db);
    expect(await adapter.readCancellation(input)).toEqual({kind:"pending",runningChildIds:[running.id]});
    expect((await store.get(org,child.id))?.status).toBe("pending");
    expect(await adapter.cancelChildren({...input,requestId:"forged"})).toEqual({kind:"unavailable"});
    expect(await adapter.cancelChildren({...input,orgId:other})).toEqual({kind:"unavailable"});
    expect(await adapter.cancelChildren(input)).toEqual({kind:"pending",runningChildIds:[running.id]});
    expect((await store.get(org,child.id))?.status).toBe("cancelled");
    await expect(store.enqueue(org,{parentRunId:parent,description:"late"})).rejects.toThrow("subtask_parent_cancelled");
    expect(await store.claimQueued(org,10)).toEqual([]);
    await store.complete(org,running.id,"actual completion");
    expect(await adapter.readCancellation(input)).toEqual({kind:"confirmed"});
  });
});

it('W16 parent cancellation suppresses a late completed child result',async()=>{
 const org=toOrgId('org-w16-'+randomUUID()),parent='parent-w16-'+randomUUID();await seed(org,parent);
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(org,{parentRunId:parent,description:'late result fence'});
 await store.claimQueued(org,20);
 try{
  await asApp(org,c=>c.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[org,parent]));
  await store.complete(org,run.id,'must never publish');
  expect(await store.get(org,run.id)).toMatchObject({status:'cancelled',result:null,error:null});
 }finally{await asApp(org,c=>c.query('UPDATE agent_runs SET cancel_requested_at=NULL WHERE org_id=$1 AND id=$2',[org,parent]));}
});

it('parent cancellation fences late file publication before any artifact/version row exists',async()=>{
 const scope=toOrgId(`org-late-file-${randomUUID()}`),parentId=`parent-late-file-${randomUUID()}`;await seed(scope,parentId);
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(scope,{parentRunId:parentId,description:'late file',outputFiles:{mediaTypes:['text/markdown'],maxFiles:1,maxTotalBytes:100}});
 await store.claimQueued(scope,1);
 await asApp(scope,async c=>{await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),scope,parentId]);await c.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[scope,parentId]);});
 await store.completeWithArtifacts(scope,run.id,'must not publish',[{name:'late.md',mime:'text/markdown',sizeBytes:4,objectKey:'immutable/late'}]);
 expect(await store.get(scope,run.id)).toMatchObject({status:'cancelled',result:null,artifactRefs:[]});
 const rows=await db.withTenant(scope,s=>s.query('SELECT id FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[scope,parentId]));expect(rows.rows).toEqual([]);
});

it('W16 cancels the actual local HTTP request across stores without claiming vendor cessation',async()=>{
 const org=toOrgId('org-w16-'+randomUUID()),parent='parent-w16-'+randomUUID();await seed(org,parent);
 const {ConfiguredModelProvider,readModelProviderConfig}=await import('../../src/infrastructure/agent-run/configured-model-provider');
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(org,{parentRunId:parent,description:'stop HTTP'});
 let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});let closed=false,calls=0,body='';
 const server=createServer((req,res)=>{
  calls++;req.on('data',chunk=>{body+=String(chunk);});req.on('end',()=>{
   res.writeHead(200,{'content-type':'application/json'});res.write('{"choices":[');entered();
  });res.on('close',()=>{closed=true;});
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const model=new ConfiguredModelProvider(readModelProviderConfig({KERNEL_MODEL_PROVIDER:'test-provider',KERNEL_MODEL_API_KEY:'test-only',KERNEL_MODEL_BASE_URL:base,KERNEL_MODEL_TIMEOUT_MS:'5000'}));

 const executor=new SubtaskRunExecutor(store,db,model,logger,false,new Map([['test-provider',5000]]));
 try{
  const execution=executor.tick(org);await started;
  expect((await new PgSubtaskRunStore(db).cancel(org,parent,run.id)).kind).toBe('cancel_requested');
  await execution;
  const end=Date.now()+2000;while(!closed&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  expect(closed).toBe(true);expect(calls).toBe(1);expect(JSON.parse(body)).not.toHaveProperty('signal');
  expect(await store.get(org,run.id)).toMatchObject({status:'failed',result:null,error:'subtask_cancel_unknown',cancellation:{state:'unknown'}});
  const restarted=new SubtaskRunExecutor(new PgSubtaskRunStore(db),db,{complete:async()=>{throw new Error('must not replay');}},logger,false,new Map([['test-provider',5000]]));
  expect(await restarted.tick(org)).toBe(0);await store.complete(org,run.id,'late result');
  expect((await store.get(org,run.id))?.result).toBeNull();
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},60000);

it('W16 stops a real remote HTTP run and resumes cancellation after a lost acknowledgment without replay',async()=>{
 const org=toOrgId('org-w16-'+randomUUID()),parent='parent-w16-'+randomUUID();await seed(org,parent);
 const {DeepAgentModelProvider,readDeepAgentProviderConfig,deriveRemoteThreadId}=await import('../../src/infrastructure/agent-run/deep-agent-model-provider');
 const {DeepAgentEngineRunController}=await import('../../src/infrastructure/plan-control/deep-agent-engine-run-controller');
 const store=new PgSubtaskRunStore(db);let started!:()=>void;const remoteStarted=new Promise<void>(r=>{started=r;});
 const states=new Map<string,string>();let submissions=0,stops=0,work=0,worker:ReturnType<typeof setInterval>|undefined,loseReply=false;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=String(chunk);
  const path=new URL(req.url!,'http://local').pathname,parts=path.split('/');
  const reply=(value:unknown)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.method==='POST'&&path==='/threads'){reply({thread_id:JSON.parse(raw).thread_id});return;}
  if(path.endsWith('/state')){reply({values:{messages:[]}});return;}
  if(req.method==='POST'&&path.endsWith('/runs')){
   const input=JSON.parse(raw);expect(input.config.configurable[EXECUTION_MODE_CONFIG_KEY]).toBe('text-only');
   submissions++;const id=randomUUID();states.set(id,'running');worker=setInterval(()=>{work++;},10);reply({run_id:id});started();return;
  }
  if(req.method==='POST'&&path.endsWith('/cancel')){
   stops++;states.set(parts[4]!,'interrupted');if(worker)clearInterval(worker);
   if(loseReply){loseReply=false;res.writeHead(200);res.write(' ');return;}
   setTimeout(()=>reply({}),30);return;
  }
  if(req.method==='GET'&&parts.length===5){reply({run_id:parts[4],status:states.get(parts[4]!)??'running'});return;}
  reply({status:'idle'});
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const old={base:process.env.KERNEL_DEEP_AGENT_BASE_URL,timeout:process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS};
 process.env.KERNEL_DEEP_AGENT_BASE_URL=base;process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS='300';

 const model=new DeepAgentModelProvider({...readDeepAgentProviderConfig(),timeoutMs:5000,pollIntervalMs:20});
 const engine=new DeepAgentEngineRunController();
 try{
  await asApp(org,c=>c.query("UPDATE agent_runs SET model_provider='deep-agent' WHERE org_id=$1 AND id=$2",[org,parent]));
  const run=await store.enqueue(org,{parentRunId:parent,description:'remote stop'});
  const executor=new SubtaskRunExecutor(store,db,model,logger,false,new Map([['deep-agent',5000]]),engine);
  const executing=executor.tick(org);await remoteStarted;
  const until=Date.now()+2000;while(!(await store.readExecution(org,run.id))?.remoteRunId&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  await new PgSubtaskRunStore(db).cancel(org,parent,run.id);await executing;
  expect(await store.get(org,run.id)).toMatchObject({status:'cancelled',result:null,cancellation:{state:'confirmed'}});
  const stoppedAt=work;await new Promise(r=>setTimeout(r,50));expect(work).toBe(stoppedAt);expect(submissions).toBe(1);expect(stops).toBeGreaterThan(0);
  const lost=await store.enqueue(org,{parentRunId:parent,description:'persisted remote handle'});await store.claimQueued(org,1);
  const remoteId=randomUUID();states.set(remoteId,'running');await store.bindRemoteRun(org,lost.id,remoteId,deriveRemoteThreadId(lost.id));
  await store.cancel(org,parent,lost.id);loseReply=true;
  await new SubtaskRunExecutor(new PgSubtaskRunStore(db),db,model,logger,false,new Map([['deep-agent',5000]]),engine).tick(org);
  expect(await store.get(org,lost.id)).toMatchObject({status:'failed',result:null,cancellation:{state:'unknown'}});
  await new SubtaskRunExecutor(new PgSubtaskRunStore(db),db,model,logger,false,new Map([['deep-agent',5000]]),engine).tick(org);
  // 这一行原来断言 `failed` —— 它把 F5 的缺陷当成了规格：对账已经确认取消（state 从
  // unknown 转 confirmed），终态却留在 failed。确认之后终态就是 cancelled。
  expect(await store.get(org,lost.id)).toMatchObject({status:'cancelled',result:null,error:null,cancellation:{state:'confirmed'}});
  expect(submissions).toBe(1);await store.complete(org,lost.id,'late');expect((await store.get(org,lost.id))?.result).toBeNull();
 }finally{
  if(worker)clearInterval(worker);server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  await asApp(org,c=>c.query("UPDATE agent_runs SET model_provider='test-provider' WHERE org_id=$1 AND id=$2",[org,parent]));
  for(const [key,value] of [['KERNEL_DEEP_AGENT_BASE_URL',old.base],['KERNEL_DEEP_AGENT_TIMEOUT_MS',old.timeout]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
 }
},60000);

/**
 * F5（run 34409361606 / job 102659917921）：父 run 取消后子任务确实停下来了，但终态落
 * `failed`；两分钟后对账把 cancellation 确认成 `confirmed`——系统此刻明知这是被取消的
 * ——终态**仍然**是 `failed`，用户主动取消与真出错在界面上分不开。
 * 生产走的是这个 PG store，所以这条断言必须在真库上成立，不许只在内存替身上绿。
 */
it('reconciliation that confirms the cancellation moves the terminal state to cancelled in the database',async()=>{
 const scope=toOrgId(`org-reconcile-${randomUUID()}`),parentId=`parent-reconcile-${randomUUID()}`;await seed(scope,parentId);
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(scope,{parentRunId:parentId,description:'stop me'});
 await store.claimQueued(scope,1);
 expect((await store.cancel(scope,parentId,run.id)).kind).toBe('cancel_requested');
 await store.bindRemoteRun(scope,run.id,'remote-reconcile','thread-reconcile');
 // 停机结果未知：这一跳落 failed + unknown 是对的（还没有证据说它是被取消停下的）。
 await store.fail(scope,run.id,'aborted mid-flight');
 expect(await store.get(scope,run.id)).toMatchObject({status:'failed',error:'subtask_cancel_unknown',cancellation:{state:'unknown'}});
 // 对账拿到证据：远端 run 确实是被取消停下的。
 await store.recordCancellation(scope,run.id,'confirmed','remote-reconcile');
 expect(await store.get(scope,run.id)).toMatchObject({status:'cancelled',result:null,error:null,cancellation:{state:'confirmed'}});
 // 终态在**数据**上就是 cancelled，不是展示层翻译出来的。
 const raw=await db.withTenant(scope,s=>s.query<{status:string;error:string|null}>('SELECT status,error FROM subtask_runs WHERE org_id=$1 AND id=$2',[scope,run.id]));
 expect(raw.rows[0]).toEqual({status:'cancelled',error:null});
});

/**
 * 语义边界：**取消之前**就真的因别的原因失败的子任务保持 `failed` 并保留自己的错因——
 * 不许为了让取消链路好看，把所有失败都翻成取消。
 */
it('a subtask that genuinely failed before any cancellation stays failed in the database',async()=>{
 const scope=toOrgId(`org-boundary-${randomUUID()}`),parentId=`parent-boundary-${randomUUID()}`;await seed(scope,parentId);
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(scope,{parentRunId:parentId,description:'really broken'});
 await store.claimQueued(scope,1);
 await store.fail(scope,run.id,'model_call_failed');
 expect(await store.get(scope,run.id)).toMatchObject({status:'failed',error:'model_call_failed'});
 expect((await store.cancel(scope,parentId,run.id)).kind).toBe('terminal_conflict');
 await store.recordCancellation(scope,run.id,'confirmed',null);
 const raw=await db.withTenant(scope,s=>s.query<{status:string;error:string|null;cancellation_state:string|null}>('SELECT status,error,cancellation_state FROM subtask_runs WHERE org_id=$1 AND id=$2',[scope,run.id]));
 expect(raw.rows[0]).toEqual({status:'failed',error:'model_call_failed',cancellation_state:null});
});

/**
 * 父 run 取消只在库里给子任务打上取消请求；真正去停远端并把终态对账到 `cancelled` 的是
 * 执行器的 tick。不 kick 就要等下一次碰巧发生的 tick——run 34409361606 里等了 119 秒，
 * 与 F5 判据 2 的 120 秒预算只差 1 秒。这条断言把"取消之后立刻推一次执行器"钉住，
 * 免得判据 2 的绿变成赢了一次赛跑。
 */
it('parent cancellation kicks the subtask executor instead of waiting for an ambient tick',async()=>{
 const scope=toOrgId(`org-kick-${randomUUID()}`),parentId=`parent-kick-${randomUUID()}`;await seed(scope,parentId);
 const {PgChildRunCanceller}=await import('../../src/infrastructure/agent-run/pg-child-run-canceller');
 const {parentCancelRequestId}=await import('../../src/application/agent-run/parent-run-control');
 const store=new PgSubtaskRunStore(db),run=await store.enqueue(scope,{parentRunId:parentId,description:'kick me'});
 await store.claimQueued(scope,1);
 const stamp=new Date();
 await asApp(scope,c=>c.query('UPDATE agent_runs SET cancel_requested_at=$3 WHERE org_id=$1 AND id=$2',[scope,parentId,stamp]));
 const kicked:string[]=[];
 const adapter=new PgChildRunCanceller(db,{kick:orgId=>{kicked.push(String(orgId));}});
 expect(await adapter.cancelChildren({orgId:scope,parentRunId:parentId,requestId:parentCancelRequestId(scope,parentId,stamp)}))
   .toEqual({kind:'pending',runningChildIds:[run.id]});
 expect(kicked).toEqual([String(scope)]);
});

/**
 * 存量归位（migrations/20260911030000_subtask_cancel_terminal_state.sql）：
 * `listCancellationRecovery` 只扫 running/unknown，已经 confirmed 却卡在 failed 的行
 * 不会被再次回访，所以必须一次性修数据。这条断言同时钉住它的**边界**——真失败的行
 * 一列都不许动。
 */
it('the backfill moves only the confirmed-cancelled rows out of failed',async()=>{
 const scope=toOrgId(`org-backfill-${randomUUID()}`),parentId=`parent-backfill-${randomUUID()}`;await seed(scope,parentId);
 const store=new PgSubtaskRunStore(db);
 const stuck=await store.enqueue(scope,{parentRunId:parentId,description:'confirmed but stuck'});
 const genuine=await store.enqueue(scope,{parentRunId:parentId,description:'really broken'});
 const pendingUnknown=await store.enqueue(scope,{parentRunId:parentId,description:'still unknown'});
 await asApp(scope,async c=>{
  await c.query("UPDATE subtask_runs SET status='failed',result=NULL,error='subtask_cancelled_after_reconciliation',cancel_requested_at=now(),cancellation_state='confirmed' WHERE org_id=$1 AND id=$2",[scope,stuck.id]);
  await c.query("UPDATE subtask_runs SET status='failed',result=NULL,error='model_call_failed' WHERE org_id=$1 AND id=$2",[scope,genuine.id]);
  await c.query("UPDATE subtask_runs SET status='failed',result=NULL,error='subtask_cancel_unknown',cancel_requested_at=now(),cancellation_state='unknown' WHERE org_id=$1 AND id=$2",[scope,pendingUnknown.id]);
 });
 const sql=await readFile(new URL('../../migrations/20260911030000_subtask_cancel_terminal_state.sql',import.meta.url),'utf8');
 await asApp(scope,c=>c.query(sql));
 expect(await store.get(scope,stuck.id)).toMatchObject({status:'cancelled',result:null,error:null});
 expect(await store.get(scope,genuine.id)).toMatchObject({status:'failed',error:'model_call_failed'});
 expect(await store.get(scope,pendingUnknown.id)).toMatchObject({status:'failed',error:'subtask_cancel_unknown',cancellation:{state:'unknown'}});
});
