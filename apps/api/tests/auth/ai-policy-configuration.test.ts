import {describe,it,expect,vi} from "vitest";
import {PgAiAdmissionRepository} from "../../src/infrastructure/auth/pg-ai-admission-repository";
import {Configuration,SetInput} from "@repo/contracts/ai-policy";
import {aiPolicyCandidates,validateAiPolicyModels} from "../../src/application/system/ai-policy-models";
import {PgPlatformOrganizationRepository} from "../../src/infrastructure/system/pg-platform-organization-repository";
import {PlatformOrganizationController} from "../../src/interface/controllers/platform-organization.controller";
import {toOrgId} from "../../src/domain/org-id";
import type {ModelPoolRepository,StoredModel} from "../../src/application/model/ports";
import {GUARDS_METADATA} from "@nestjs/common/constants";
import {PlatformOperatorGuard} from "../../src/interface/guards/platform-operator.guard";
const config={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Asia/Shanghai"},ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",
 prices:[{modelId:"fixture-model",modelProvider:"fixture-route",runtimeModelId:"fixture-runtime-model",inputMicrosPerMillion:"10",outputMicrosPerMillion:"20",cachedInputMicrosPerMillion:"5",maxInputTokens:100,maxOutputTokens:200}],fallbackModelIds:[],maxAttempts:1};
const input={expectedVersion:0,reason:"explicit fixture configuration",configuration:config};
const model=(id:string,over:Partial<StoredModel["row"]>={}):StoredModel=>({credentialConfigured:true,row:{modelId:id,displayName:id,status:"已启用",kind:"closed-api",shape:"single",vendor:"fixture",capabilityTags:[],contextWindow:1000,unitPrice:999,complianceAttrs:[],members:[],...over}});
const pool=(rows:StoredModel[])=>({listForOrg:vi.fn().mockResolvedValue(rows)} as unknown as ModelPoolRepository);
const org=toOrgId("org-policy-5261");
describe("operator AI configuration without guessed activation",()=>{
 it("strict integers/window/timezone, bounded attempts and authorized unique references",()=>{
  expect(Configuration.parse(config)).toEqual(config);
  expect(Configuration.safeParse({...config,costMicrosPerUser:"not a number"}).success).toBe(false);
  expect(Configuration.safeParse({...config,costMicrosPerUser:"1.5"}).success).toBe(false);
  for(const bad of [{...config,costMicrosPerUser:"9223372036854775808"},{...config,costMicrosPerUser:"1.5"},{...config,window:{...config.window,timezone:"invalid/zone"}},
   {...config,fallbackModelIds:["unknown"]},{...config,maxAttempts:2},{...config,prices:[...config.prices,...config.prices]}])expect(()=>Configuration.parse(bad)).toThrow();
  expect(()=>SetInput.parse({...input,orgId:"another-tenant",enabled:true})).toThrow();
  expect(Configuration.parse({...config,ordinaryTokensPerUser:null}).ordinaryTokensPerUser).toBeNull();
 });
 it("uses official selectable and confidential rules, omits secret/admin price fields and unsupported composites",async()=>{
  const repo=pool([model("enabled"),model("disabled",{status:"已停用"}),model("local",{kind:"self-hosted"}),model("composite",{shape:"composite",members:[{modelId:"missing",role:"step"}]})]);
  expect((await aiPolicyCandidates(repo,String(org),["fixture-route"])).map(row=>row.modelId)).toEqual(["enabled","local"]);
  const confidential=await aiPolicyCandidates(repo,String(org),["fixture-route"],"confidential");expect(confidential.map(row=>row.modelId)).toEqual(["local"]);
  expect(Object.keys(confidential[0]!)).not.toEqual(expect.arrayContaining(["credential","endpoint","unitPrice"]));
 });
 it("unknown model/route and oversized context never become a configured fallback",async()=>{
  await validateAiPolicyModels(pool([model("fixture-model")]),String(org),config,["fixture-route"]);
  await expect(validateAiPolicyModels(pool([]),String(org),config,["fixture-route"])).rejects.toMatchObject({reasonCode:"AI_POLICY_MODEL_UNAVAILABLE"});
  await expect(validateAiPolicyModels(pool([model("fixture-model")]),String(org),config,[])).rejects.toMatchObject({reasonCode:"AI_POLICY_MODEL_UNAVAILABLE"});
  await expect(validateAiPolicyModels(pool([model("fixture-model",{contextWindow:250})]),String(org),config,["fixture-route"])).rejects.toMatchObject({reasonCode:"AI_POLICY_MODEL_UNAVAILABLE"});
 });
 it("all policy methods inherit operator guard and audit failure blocks pool disclosure/writes",async()=>{
  expect(Reflect.getMetadata(GUARDS_METADATA,PlatformOrganizationController)).toContain(PlatformOperatorGuard);
  const repo={getAiPolicy:vi.fn().mockRejectedValue(new Error("audit unavailable")),setAiPolicy:vi.fn()},models=pool([]);
  const controller=new PlatformOrganizationController(repo as never,{} as never,models,{registeredProviders:()=>["fixture-route"]} as never);
  const principal={userId:"operator",orgId:toOrgId("platform")};
  await expect(controller.aiCandidates(String(org),principal)).rejects.toThrow("audit unavailable");
  await expect(controller.setAiPolicy(String(org),input,principal)).rejects.toThrow("audit unavailable");
  expect(models.listForOrg).not.toHaveBeenCalled();expect(repo.setAiPolicy).not.toHaveBeenCalled();
 });
 it("missing configuration is explicit null/pending, excluded org kinds fail before policy SQL",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("FROM organizations")?[{id:org}]:[]}));
  const db={withTenant:async(_org:unknown,fn:(s:unknown)=>unknown)=>fn({query})};const repo=new PgPlatformOrganizationRepository(db as never,null);
  expect(await repo.getAiPolicy(org,"operator")).toMatchObject({version:0,configuration:null,priceVersion:null,enforcement:"pending"});
  query.mockResolvedValue({rows:[]});await expect(repo.getAiPolicy(org,"operator")).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
 });
 it("optimistic conflict and existing overlapping budgets reject before any configuration write",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("FROM organizations")?[{id:org}]:sql.includes("FROM organization_ai_policies")?[{version:2,configuration:config,price_version:"old",updated_by:"op",updated_at:new Date()}]:[]}));
  const repo=new PgPlatformOrganizationRepository({withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}} as never,null);
  await expect(repo.setAiPolicy(org,input,"operator")).rejects.toMatchObject({reasonCode:"AI_POLICY_VERSION_CONFLICT"});
  expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");expect(query.mock.calls.some(([sql])=>sql.includes("INSERT"))).toBe(false);
  query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM organizations")||sql.includes("FROM ai_budget_windows")?[{id:org}]:[]}));
  await expect(repo.setAiPolicy(org,input,"operator")).rejects.toMatchObject({reasonCode:"AI_POLICY_WINDOW_LOCKED"});
  expect(query.mock.calls.some(([sql])=>sql.includes("INSERT"))).toBe(false);
 });
});

describe("immutable per-user policy materialization",()=>{
 const fixture=(over:{member?:boolean;plan?:string;active?:boolean;overlap?:unknown[]}={})=>{
  const query=vi.fn(async(sql:string,_params?:readonly unknown[])=>({rows:
   sql.includes("FROM organizations")?[{id:org}]:
   sql.includes("FROM org_memberships")?(over.member===false?[]:[{exists:1}]):
   sql.includes("FROM organization_plans")?[{plan:over.plan??"ordinary"}]:
   sql.includes("FROM organization_ai_policies")?[{configuration:config,price_version:"fixture-v1",updated_by:"actual-operator"}]:
   sql.includes("AS active")?[{active:over.active??true}]:
   sql.includes("FROM ai_budget_windows")?(over.overlap??[]):[]}));
  const repo=new PgAiAdmissionRepository({withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}} as never);
  return {repo,query};
 };
 it("uses authenticated membership and audited operator attribution before creating a window",async()=>{
  const {repo,query}=fixture();expect(await repo.resolveBudgetPolicy(org,"member")).toMatchObject({decision:"configured",priceVersion:"fixture-v1"});
  expect(query.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock(hashtext($1))");
  expect(query.mock.calls[2]?.[0]).toContain("FOR UPDATE");
  const insert=query.mock.calls.find(([sql])=>sql.includes("INSERT INTO ai_budget_windows"));
  expect(insert).toBeDefined();
  expect((insert as unknown as [string,unknown[]])[1]).toEqual([org,"member",config.window.start,config.window.end,config.window.timezone,"100","10000","CNY","fixture-v1","actual-operator"]);
 });
 it("denies nonmembers and inactive windows without inserting or reserving",async()=>{
  for(const [options,decision] of [[{member:false},"AI_SUBJECT_NOT_MEMBER"],[{active:false},"BUDGET_WINDOW_INACTIVE"]] as const){
   const {repo,query}=fixture(options);expect(await repo.resolveBudgetPolicy(org,"member")).toEqual({decision});
   expect(query.mock.calls.some(([sql])=>sql.includes("INSERT")||sql.includes("ai_request_reservations"))).toBe(false);
  }
 });
 it("reuses identical snapshots and rejects overlapping changed prices without resetting consumption",async()=>{
  const row={window_start:new Date(config.window.start),window_end:new Date(config.window.end),timezone:config.window.timezone,token_limit:"100",cost_limit_micros:"10000",currency:"CNY",price_version:"fixture-v1"};
  const same=fixture({overlap:[row]});expect(await same.repo.resolveBudgetPolicy(org,"member")).toMatchObject({decision:"configured"});
  expect(same.query.mock.calls.some(([sql])=>sql.includes("INSERT")||sql.includes("UPDATE ai_budget"))).toBe(false);
  const changed=fixture({overlap:[{...row,price_version:"other"}]});await expect(changed.repo.resolveBudgetPolicy(org,"member")).rejects.toThrow("AI_BUDGET_TEMPLATE_MISMATCH");
  expect(changed.query.mock.calls.some(([sql])=>sql.includes("INSERT")||sql.includes("UPDATE ai_budget"))).toBe(false);
 });
});

describe("durable reservation price snapshot",()=>{
 it("uses the immutable audited price version without consulting current policy",async()=>{
  const query=vi.fn(async(sql:string,_params:readonly unknown[]=[])=>({rows:sql.includes("FROM ai_request_reservations")?[{user_id:"u",model_provider:"fixture-route",model_id:"fixture-runtime-model",currency:"CNY",price_version:"old-audit"}]:sql.includes("FROM organization_ai_policy_changes")?[{configuration:config}]:[]}));
  const repo=new PgAiAdmissionRepository({withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}} as never);
  expect(await repo.readReservedPrice(org,"request")).toMatchObject({userId:"u",priceVersion:"old-audit",price:config.prices[0]});
  expect(query.mock.calls.map(call=>call[0]).join("\n")).not.toContain("FROM organization_ai_policies ");
  expect(query.mock.calls[1]?.[1]).toEqual([org,"old-audit"]);
 });
 it("unknown, missing/ambiguous old audits and wrong currency never guess current or free price",async()=>{
  const reservation={user_id:"u",model_provider:"fixture-route",model_id:"fixture-runtime-model",currency:"USD",price_version:"old"};
  let rows:unknown[]=[];
  const query=vi.fn(async(sql:string,_params:readonly unknown[]=[])=>({rows:sql.includes("FROM ai_request_reservations")?[reservation]:rows}));
  const repo=new PgAiAdmissionRepository({withTenant:async(_org:unknown,fn:(s:unknown)=>unknown)=>fn({query})} as never);
  await expect(repo.readReservedPrice(org,"r")).rejects.toThrow("AI_RESERVED_PRICE_SNAPSHOT_UNAVAILABLE");
  rows=[{configuration:config},{configuration:config}];await expect(repo.readReservedPrice(org,"r")).rejects.toThrow("AI_RESERVED_PRICE_SNAPSHOT_UNAVAILABLE");
  rows=[{configuration:config}];await expect(repo.readReservedPrice(org,"r")).rejects.toThrow("AI_RESERVED_PRICE_SNAPSHOT_MISMATCH");
 });
});
