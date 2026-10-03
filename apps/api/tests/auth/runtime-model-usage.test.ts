import {readFileSync} from "node:fs";
import {describe,it,expect,vi,afterEach} from "vitest";
import {RuntimeModelUsageController} from "../../src/interface/controllers/runtime-model-usage.controller";
import {RuntimeModelRequestStart} from "@repo/contracts/runtime-model-usage";
import {PgRuntimeModelUsageRepository} from "../../src/infrastructure/auth/pg-runtime-model-usage-repository";
import {runtimeUsageObserver} from "../../src/application/agent-run/runtime-model-usage";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("tenant-a"),requestId="aa945fbd-9383-428d-b80b-b339fc49ea27";
const start={orgId:org,requestId,attemptId:"run-A:1",leaseEpoch:2,startedAt:"2026-10-04T01:00:00.000Z",modelId:"registered-test",callPurpose:"primary" as const};
const terminal={orgId:org,requestId,attemptId:start.attemptId,leaseEpoch:2,endedAt:"2026-10-04T01:01:00.000Z",outcome:"failed" as const,usage:{total:20,prompt:12,completion:8}};
afterEach(()=>vi.unstubAllEnvs());
describe("runtime request trusted ownership",()=>{
 it("ownership exemption stays metadata-only and tenant-scoped with no row disclosure",()=>{
  const source=readFileSync(new URL("../../src/infrastructure/auth/pg-runtime-model-usage-repository.ts",import.meta.url),"utf8");
  expect(source).not.toContain("withoutTenant");
  const tables=[...source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(match=>match[1]);
  for(const table of tables)expect(["model_request_starts","agent_runs","chat_threads","chat_messages","agent_run_steps","subtask_runs"]).toContain(table);
  expect(source).not.toMatch(/SELECT\s+\*|\b(?:m|t|r|p|c|s)\.(?:body|content|instructions|input_full_content|output_full_content)\b/i);
  expect(source).not.toMatch(/return\s+\w+\.rows/);
  expect(source).toContain("FOR SHARE OF r");expect(source).toContain("FOR SHARE OF p,c");
 });
 it("private service key and strict metadata reject browsers and caller-chosen user identity",async()=>{
  vi.stubEnv("DEEP_AGENT_SERVICE_INTERNAL_KEY","test-key");const startRuntimeRequest=vi.fn(),terminalRuntimeRequest=vi.fn();
  const controller=new RuntimeModelUsageController({startRuntimeRequest,terminalRuntimeRequest});
  await expect(controller.start(undefined,"run-A",start)).rejects.toMatchObject({status:401});
  await expect(controller.start("test-key","run-A",{...start,userId:"another-user",prompt:"secret"})).rejects.toMatchObject({status:400});
  expect(startRuntimeRequest).not.toHaveBeenCalled();expect(terminalRuntimeRequest).not.toHaveBeenCalled();
  expect(()=>RuntimeModelRequestStart.parse({...start,leaseEpoch:0})).toThrow();
 });
 it("foreign/stale ownership never reaches durable start",async()=>{
  vi.stubEnv("KERNEL_MODEL_PROVIDER","configured-test");const query=vi.fn().mockResolvedValue({rows:[]});
  const db={withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}};
  const repo=new PgRuntimeModelUsageRepository(db as never,{record:vi.fn()} as never);
  await expect(repo.startRuntimeRequest(org,"run-A",start)).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");
  expect(query.mock.calls.some(call=>String(call[0]).includes("INSERT"))).toBe(false);
 });
 it("terminal uses immutable start attribution even after lease expiry and preserves billed failed usage",async()=>{
  const row={user_id:"trusted-user",run_id:"run-A",subtask_id:null,execution_attempt_id:start.attemptId,execution_lease_epoch:"2",project_id:"trusted-project",thread_id:"trusted-thread",agent_id:"trusted-agent",model_provider:"actual-provider",model_id:"actual-model",call_purpose:"primary",started_at:new Date(start.startedAt)};
  const query=vi.fn().mockImplementation(async(sql:string)=>({rows:sql.includes("FROM model_request_starts")?[row]:[]}));
  const db={withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}};
  const record=vi.fn();const repo=new PgRuntimeModelUsageRepository(db as never,{record} as never);await repo.terminalRuntimeRequest(org,"run-A",terminal);
  expect(record).toHaveBeenCalledWith(org,expect.objectContaining({eventId:requestId,userId:"trusted-user",runId:"run-A",modelProvider:"actual-provider",modelId:"actual-model",tokensTotal:20,promptTokens:12,completionTokens:8,outcome:"failed",projectId:"trusted-project",threadId:"trusted-thread",agentId:"trusted-agent"}));
  await expect(repo.terminalRuntimeRequest(org,"run-other",terminal)).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");
  await expect(repo.terminalRuntimeRequest(org,"run-A",{...terminal,leaseEpoch:3})).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");
 });
 it("missing start refuses terminal instead of fabricating caller attribution",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});const repo=new PgRuntimeModelUsageRepository({withTenant:async(_tenant:unknown,fn:(s:unknown)=>unknown)=>fn({query})} as never,{record:vi.fn()} as never);
  await expect(repo.terminalRuntimeRequest(org,"run-A",terminal)).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");expect(query).toHaveBeenCalledTimes(1);
 });
 it("subtask actual observer propagates own lease while terminal records root and child separately",async()=>{
  const startRuntimeRequest=vi.fn(),terminalRuntimeRequest=vi.fn();
  const observer=runtimeUsageObserver({startRuntimeRequest,terminalRuntimeRequest},org,"child-A","child-A:1",3,"pinned-model");
  await observer({phase:"started",requestId,startedAt:start.startedAt});
  await observer({phase:"terminal",requestId,startedAt:start.startedAt,endedAt:terminal.endedAt,outcome:"failed",usage:{total:7}});
  expect(startRuntimeRequest).toHaveBeenCalledWith(org,"child-A",expect.objectContaining({attemptId:"child-A:1",leaseEpoch:3,modelId:"pinned-model",requestId}));
  expect(terminalRuntimeRequest).toHaveBeenCalledWith(org,"child-A",expect.objectContaining({usage:{total:7},requestId}));
  const row={user_id:"trusted-user",run_id:"root-A",subtask_id:"child-A",execution_attempt_id:"child-A:1",execution_lease_epoch:"3",project_id:"trusted-project",thread_id:"trusted-thread",agent_id:"trusted-agent",model_provider:"actual-provider",model_id:"pinned-model",call_purpose:"primary",started_at:new Date(start.startedAt)};
  const query=vi.fn().mockResolvedValue({rows:[row]}),record=vi.fn();
  const repo=new PgRuntimeModelUsageRepository({withTenant:async(_tenant:unknown,fn:(s:unknown)=>unknown)=>fn({query})} as never,{record} as never);
  await repo.terminalRuntimeRequest(org,"child-A",{...terminal,attemptId:"child-A:1",leaseEpoch:3});
  expect(record).toHaveBeenCalledWith(org,expect.objectContaining({runId:"root-A",subtaskId:"child-A",userId:"trusted-user"}));
  await expect(repo.terminalRuntimeRequest(org,"root-A",{...terminal,attemptId:"child-A:1",leaseEpoch:3})).rejects.toThrow("RUNTIME_USAGE_OWNERSHIP_DENIED");
 });

});
