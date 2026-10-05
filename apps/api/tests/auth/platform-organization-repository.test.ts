import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAiAdmissionRepository } from "../../src/infrastructure/auth/pg-ai-admission-repository";
import { PgPlatformOrganizationRepository } from "../../src/infrastructure/system/pg-platform-organization-repository";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";

const ORG="org-plan-5261", EMPTY="org-plan-5261-empty", LOCAL="org-plan-5261-local", ACTOR="operator-5261";
const policyInput={expectedVersion:0,reason:"explicit fixture policy",configuration:{window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},
 ordinaryTokensPerUser:"100",costMicrosPerUser:"10000",currency:"CNY",prices:[{modelId:"fixture-pool-id",modelProvider:"fixture-route",runtimeModelId:"fixture-runtime-model",
 inputMicrosPerMillion:"10",outputMicrosPerMillion:"20",cachedInputMicrosPerMillion:"5",maxInputTokens:100,maxOutputTokens:200}],fallbackModelIds:[],maxAttempts:1}};
let db: PgDatabase;
let repo: PgPlatformOrganizationRepository;
/** Isolated CI DB only: emulate the independently provisioned NOLOGIN group without credentials. */
const catalog: DatabasePort = {
  withTenant: async () => { throw new Error("catalog must never access tenant tables"); },
  withoutTenant: async fn => asOwner(async c => {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE app_platform_org_catalog_ro");
    const session: TenantSession = { query: async <R>(sql: string, params?: readonly unknown[]) => ({ rows: (await c.query(sql, params ? [...params] : undefined)).rows as R[] }) };
    try{const result=await fn(session);await c.query("COMMIT");return result;}
    catch(error){await c.query("ROLLBACK");throw error;}
  }), close: async () => {},
};
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  await asOwner(c => c.query(readFileSync(new URL("../../provisioning/platform-org-catalog.sql",import.meta.url),"utf8")));
  db=new PgDatabase(appConfig()); repo=new PgPlatformOrganizationRepository(db,catalog);
},60000);
beforeEach(async () => {
  await resetOrgs(ORG,EMPTY,LOCAL);
  await seedOrg({orgId:ORG,projectId:`${ORG}-project`});
  // Truly empty organization: no project, member, credential or account discovery path.
  await asOwner(c => c.query("INSERT INTO organizations(id,name,kind) VALUES ($1,'plan empty','organization')",[EMPTY]));
  await seedOrg({orgId:LOCAL,projectId:`${LOCAL}-project`,kind:"personal-local",ownerUserId:"local-owner-5261"});
  await addOrgMember(LOCAL,"local-owner-5261","admin",null);
  await addOrgMember(ORG,"member-5261","consultant",null);
});
afterAll(async () => { await resetOrgs(ORG,EMPTY,LOCAL); await db?.close(); });
describe("platform organization catalog and plan transactional boundary", () => {
  it("materializes one immutable member window under concurrent workers and denies foreign members",async()=>{
    const admission=new PgAiAdmissionRepository(db);
    const dynamic={...policyInput,configuration:{...policyInput.configuration,window:{start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),timezone:"Etc/UTC"}}};
    await repo.setPlan(toOrgId(ORG),{plan:"ordinary",expectedVersion:0,reason:"test explicit plan"},ACTOR);
    await repo.setAiPolicy(toOrgId(ORG),dynamic,ACTOR);
    const responses=await Promise.all([admission.resolveBudgetPolicy(toOrgId(ORG),"member-5261"),admission.resolveBudgetPolicy(toOrgId(ORG),"member-5261")]);
    expect(responses.every(result=>result.decision==="configured")).toBe(true);
    expect((await asApp(ORG,c=>c.query("SELECT user_id,configured_by FROM ai_budget_windows WHERE org_id=$1",[ORG]))).rows).toEqual([{user_id:"member-5261",configured_by:ACTOR}]);
    expect(await admission.resolveBudgetPolicy(toOrgId(ORG),"foreign-user")).toEqual({decision:"AI_SUBJECT_NOT_MEMBER"});
    expect((await asApp(EMPTY,c=>c.query("SELECT user_id FROM ai_budget_windows WHERE org_id=$1",[ORG]))).rows).toEqual([]);
    await expect(asApp(ORG,c=>c.query("UPDATE ai_budget_windows SET token_limit=999 WHERE org_id=$1",[ORG]))).rejects.toThrow();
    await expect(asApp(ORG,c=>c.query("DELETE FROM ai_budget_windows WHERE org_id=$1",[ORG]))).rejects.toThrow();
  });
  it("serializes first policy configuration with one immutable snapshot and tenant-isolated audit",async()=>{
    const results=await Promise.allSettled([repo.setAiPolicy(toOrgId(ORG),policyInput,ACTOR),repo.setAiPolicy(toOrgId(ORG),policyInput,ACTOR)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const denied=results.find(result=>result.status==="rejected");expect(denied?.status==="rejected"&&denied.reason.reasonCode).toBe("AI_POLICY_VERSION_CONFLICT");
    const stored=await repo.getAiPolicy(toOrgId(ORG),ACTOR);expect(stored).toMatchObject({version:1,configuration:policyInput.configuration,enforcement:"pending"});expect(stored.changes).toHaveLength(1);
    await expect(asApp(ORG,c=>c.query("UPDATE organization_ai_policy_changes SET reason='rewrite' WHERE org_id=$1",[ORG]))).rejects.toThrow();
    expect((await asApp(EMPTY,c=>c.query("SELECT version FROM organization_ai_policy_changes WHERE org_id=$1",[ORG]))).rows).toEqual([]);
    await expect(repo.setAiPolicy(toOrgId(LOCAL),policyInput,ACTOR)).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
  });
  it("audit insertion failure rolls back the actual PostgreSQL policy mutation",async()=>{
    const faultDb:DatabasePort={withTenant:(tenant,fn)=>db.withTenant(tenant,s=>fn({query:async<R>(sql:string,params?:readonly unknown[])=>{
      if(sql.includes("INSERT INTO organization_ai_policy_changes"))throw new Error("injected audit failure");
      return s.query<R>(sql,params);
    }})),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{}};
    await expect(new PgPlatformOrganizationRepository(faultDb,null).setAiPolicy(toOrgId(ORG),policyInput,ACTOR)).rejects.toThrow("injected audit failure");
    expect((await asApp(ORG,c=>c.query("SELECT version FROM organization_ai_policies WHERE org_id=$1",[ORG]))).rows).toEqual([]);
    expect((await asApp(ORG,c=>c.query("SELECT version FROM organization_ai_policy_changes WHERE org_id=$1",[ORG]))).rows).toEqual([]);
  });
  it("editing configuration cannot reset or overlap an established per-user budget",async()=>{
    await repo.setAiPolicy(toOrgId(ORG),policyInput,ACTOR);
    await asOwner(c=>c.query(`INSERT INTO ai_budget_windows(org_id,user_id,window_start,window_end,timezone,token_limit,cost_limit_micros,currency,price_version,configured_by)
      VALUES($1,'fixture-user',$2,$3,'Etc/UTC',100,10000,'CNY','fixture-v1',$4)`,[ORG,policyInput.configuration.window.start,policyInput.configuration.window.end,ACTOR]));
    await expect(repo.setAiPolicy(toOrgId(ORG),{...policyInput,expectedVersion:1},ACTOR)).rejects.toMatchObject({reasonCode:"AI_POLICY_WINDOW_LOCKED"});
    expect((await repo.getAiPolicy(toOrgId(ORG),ACTOR)).version).toBe(1);
    expect((await asApp(ORG,c=>c.query("SELECT token_limit::text,cost_limit_micros::text FROM ai_budget_windows WHERE org_id=$1",[ORG]))).rows).toEqual([{token_limit:"100",cost_limit_micros:"10000"}]);
  });
  it("discovers a truly empty SaaS org and preserves local privacy", async () => {
    const out=await repo.list({search:"plan",limit:50},ACTOR);
    expect(out.organizations.some(o => o.orgId===EMPTY && o.memberCount===0 && o.plan.plan===null)).toBe(true);
    expect(out.organizations.some(o => o.orgId===LOCAL)).toBe(false);
    await expect(repo.detail(toOrgId(LOCAL),ACTOR)).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
    await expect(repo.setPlan(toOrgId(LOCAL),{plan:"enterprise",expectedVersion:0,reason:"test"},ACTOR)).rejects.toMatchObject({reasonCode:"ORGANIZATION_NOT_FOUND"});
  });
  it("app_rw cannot enumerate another org or switch to the catalog role", async () => {
    const rows=await asApp(ORG,c => c.query("SELECT id FROM organizations").then(r => r.rows));
    expect(rows.every(r=>r.id===ORG)).toBe(true);
    await expect(asApp(ORG,c=>c.query("SET LOCAL ROLE app_platform_org_catalog_ro"))).rejects.toThrow();
    await expect(catalog.withoutTenant(s=>s.query("SELECT user_id FROM org_memberships"))).rejects.toThrow();
  });
  it("catalog unavailable is explicit, not an empty list",async()=>{
    await expect(new PgPlatformOrganizationRepository(db,null).list({search:"",limit:25},ACTOR)).rejects.toMatchObject({reasonCode:"PLATFORM_CATALOG_UNAVAILABLE"});
  });
  it("serializes concurrent initial plan edits and creates one audit row",async()=>{
    const input={plan:"enterprise" as const,expectedVersion:0,reason:"contract 5261"};
    const results=await Promise.allSettled([repo.setPlan(toOrgId(EMPTY),input,ACTOR),repo.setPlan(toOrgId(EMPTY),input,"other-operator")]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    const detail=await repo.detail(toOrgId(EMPTY),ACTOR);
    expect(detail.organization.plan).toMatchObject({plan:"enterprise",version:1,enforcement:"pending"});
    expect(detail.changes).toHaveLength(1);
    expect(detail.changes[0]).toMatchObject({previousPlan:null,plan:"enterprise",reason:"contract 5261"});
    await expect(asApp(EMPTY,c=>c.query("UPDATE organization_plan_changes SET reason='rewritten' WHERE org_id=$1",[EMPTY]))).rejects.toThrow();
    expect(await asApp(ORG,c=>c.query("SELECT id FROM organization_plan_changes").then(r=>r.rows))).toHaveLength(0);
  });
  it("search and keyset pages stay bounded and access is audited",async()=>{
    const first=await repo.list({search:"plan",limit:1},ACTOR);
    expect(first.organizations.length).toBeLessThanOrEqual(1);
    if(first.nextCursor){
      const second=await repo.list({search:"plan",limit:1,cursor:first.nextCursor},ACTOR);
      expect(second.organizations[0]?.orgId).not.toBe(first.organizations[0]?.orgId);
    }
    const log=await asOwner(c=>c.query("SELECT id FROM platform_organization_access_events WHERE actor_id=$1 AND action='list'",[ACTOR]));
    expect(log.rows.length).toBeGreaterThan(0);
    await expect(asApp(ORG,c=>c.query("SELECT * FROM platform_organization_access_events"))).rejects.toThrow();
    await expect(asApp(ORG,c=>c.query(`INSERT INTO platform_organization_access_events(id,org_id,actor_id,action)
      VALUES('forged-audit','org-platform',$1,'list')`,[ACTOR]))).rejects.toThrow();
  });
});


describe("catalog literal search",()=>{
 it("escapes wildcard percent/underscore and preserves literal backslash",async()=>{
  const name="plan %_\\ catalog";
  await asOwner(c=>c.query("UPDATE organizations SET name=$2 WHERE id=$1",[EMPTY,name]));
  const out=await repo.list({search:"%_\\",limit:50},ACTOR);
  expect(out.organizations.map(o=>o.orgId)).toEqual([EMPTY]);
 });
});
