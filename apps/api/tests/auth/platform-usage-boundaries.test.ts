import "reflect-metadata";
import {KernelModule} from "../../src/kernel.module";
import type {FactoryProvider} from "@nestjs/common";
import {DATABASE_PORT} from "../../src/application/ports/database.port";
import {RUNTIME_MODEL_USAGE,type RuntimeModelUsagePort} from "../../src/application/agent-run/runtime-model-usage";
import {TOKEN_USAGE_METER} from "../../src/application/agent-run/ports";
import {CORE_MODEL_RUNTIME_GUARD} from "../../src/infrastructure/model/core-model-runtime-guard";
import {AI_QUOTA_RUNTIME_WIRING} from "../../src/infrastructure/agent-run/ai-runtime-wiring";
import {readFileSync} from "node:fs";
import {describe,expect,it,vi} from "vitest";
import {GUARDS_METADATA} from "@nestjs/common/constants";
import {aiUsage as U} from "@repo/contracts";
import {PlatformOrganizationController} from "../../src/interface/controllers/platform-organization.controller";
import {PlatformOperatorGuard} from "../../src/interface/guards/platform-operator.guard";
import {PgPlatformOrganizationRepository} from "../../src/infrastructure/system/pg-platform-organization-repository";
import {toOrgId} from "../../src/domain/org-id";
const source=(relative:string)=>readFileSync(new URL(relative,import.meta.url),"utf8");
describe("#5261 metadata exemption enforced premises",()=>{
 it("usage never reads content/credentials, stays tenant-bound and discloses a strict metadata schema",()=>{
  const repo=source("../../src/infrastructure/auth/pg-ai-usage-repository.ts");
  expect(repo).not.toContain("withoutTenant");expect(repo).not.toMatch(/\b(FROM|JOIN)\s+(credentials|artifacts|chat_messages|agent_run_steps)\b/i);
  expect(U.Call.keyof().options).not.toEqual(expect.arrayContaining(["prompt","response"]));
  for(const field of ["prompt","response","content","body","inputFullContent","outputFullContent"])expect(U.Call.keyof().options).not.toContain(field);
  expect(source("../../src/interface/controllers/ai-usage.controller.ts")).toContain("await this.scoped(principal,orgId,input)");
 });
 it("admission exposes no raw usage/budget rows and does not use untentanted SQL",()=>{
  const repo=source("../../src/infrastructure/auth/pg-ai-admission-repository.ts");
  expect(repo).not.toContain("withoutTenant");expect(repo).not.toMatch(/return\s+(policy|used|held|receipt|row)\.rows/);
  expect(repo).not.toMatch(/\b(FROM|JOIN)\s+(artifacts|chat_messages|agent_run_steps|credentials)\b/i);
  // Product admission stays default-off; the independent accepted-model guard is tested below.
  expect(source("../../src/kernel.module.ts")).toContain('createAiQuotaRuntimeWiring(process.env.KERNEL_AI_PRODUCT_QUOTA_ENABLED==="1"');
 });
 it("production DI keeps accepted core snapshots guarded when product quota wiring is disabled",async()=>{
  const providers=Reflect.getMetadata("providers",KernelModule) as FactoryProvider[];
  const factory=providers.find(provider=>provider.provide===RUNTIME_MODEL_USAGE);
  expect(factory).toBeDefined();expect(factory!.inject).toEqual([DATABASE_PORT,TOKEN_USAGE_METER,AI_QUOTA_RUNTIME_WIRING,CORE_MODEL_RUNTIME_GUARD]);
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("FROM agent_runs")?[{user_id:"actual-user",project_id:"project",thread_id:"thread",agent_id:"agent",root_run_id:"accepted-root",subtask_id:null}]:[]}));
  const db={withTenant:async(org:unknown,work:Function)=>{expect(org).toBe("formal");return work({query});}};
  const guard={assertAccepted:vi.fn(async()=>{throw new Error("CORE_MODEL_UNAVAILABLE");})};
  const previous=process.env.KERNEL_MODEL_PROVIDER;process.env.KERNEL_MODEL_PROVIDER="fixture-provider";
  try{
   const runtime=factory!.useFactory(db,{record:vi.fn()},null,guard) as RuntimeModelUsagePort;
   await expect(runtime.startRuntimeRequest(toOrgId("formal"),"accepted-root",{requestId:"actual-request",attemptId:"actual-attempt",leaseEpoch:1,modelId:"accepted-model",callPurpose:"primary",startedAt:"2026-10-05T00:00:00Z"})).rejects.toThrow("CORE_MODEL_UNAVAILABLE");
   expect(guard.assertAccepted).toHaveBeenCalledWith("formal","accepted-root",expect.any(Object));
   expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
  }finally{if(previous===undefined)delete process.env.KERNEL_MODEL_PROVIDER;else process.env.KERNEL_MODEL_PROVIDER=previous;}
 });
 it("platform routes remain guarded and audit writes have the platform tenant scope",()=>{
  expect(Reflect.getMetadata(GUARDS_METADATA,PlatformOrganizationController)).toContain(PlatformOperatorGuard);
  const repo=source("../../src/infrastructure/system/pg-platform-organization-repository.ts");
  expect(repo.match(/\.withoutTenant\(/g)).toHaveLength(1);expect(repo).toContain("this.catalog.withoutTenant");
  expect(repo).toContain("this.db.withTenant(toOrgId(PLATFORM_ORG_ID)");
  expect(repo).toContain("kind='organization'");
 });
 it("audit rejection prevents both platform usage reads",async()=>{
  const auditUsageAccess=vi.fn().mockRejectedValue(new Error("audit unavailable"));
  const summary=vi.fn(),calls=vi.fn();
  const controller=new PlatformOrganizationController({auditUsageAccess} as never,{summary,calls} as never);
  const query={start:"2026-01-01T00:00:00Z",end:"2026-01-02T00:00:00Z",timezone:"UTC"};
  for(const method of ["usageSummary","usageCalls"] as const)
   await expect(controller[method]("formal",query as never,{userId:"operator",orgId:toOrgId("platform")})).rejects.toThrow("audit unavailable");
  expect(auditUsageAccess).toHaveBeenCalledTimes(2);expect(summary).not.toHaveBeenCalled();expect(calls).not.toHaveBeenCalled();
 });
 it("unsafe catalog role stops enumeration before organization SQL",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{safe:false}]});
  const catalog={withoutTenant:async(fn:(s:unknown)=>unknown)=>fn({query})};
  const repo=new PgPlatformOrganizationRepository({} as never,catalog as never);
  await expect(repo.list({search:"",limit:25},"operator")).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
  expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]?.[0]).toContain("NOT r.rolsuper");
 });
 it("all target read/write paths reject excluded organization kinds",async()=>{
  const query=vi.fn(async(sql:string)=>({rows: sql.includes("kind='organization'")?[]:[{id:"local",name:"local",kind:"personal-local"}]}));
  const db={withTenant:async(_org:unknown,fn:(s:unknown)=>unknown)=>fn({query})};
  const repo=new PgPlatformOrganizationRepository(db as never,null);
  await expect(repo.detail(toOrgId("local"),"operator")).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
  await expect(repo.auditUsageAccess(toOrgId("local"),"operator")).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
  await expect(repo.setPlan(toOrgId("local"),{plan:"enterprise",expectedVersion:0,reason:"test"},"operator")).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
  expect(query).toHaveBeenCalledTimes(3);
 });

});
