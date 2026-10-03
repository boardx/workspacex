import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgPlatformOrganizationRepository } from "../../src/infrastructure/system/pg-platform-organization-repository";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";

const ORG="org-plan-5261", EMPTY="org-plan-5261-empty", LOCAL="org-plan-5261-local", ACTOR="operator-5261";
let db: PgDatabase;
let repo: PgPlatformOrganizationRepository;
/** Isolated CI DB only: emulate the independently provisioned NOLOGIN group without credentials. */
const catalog: DatabasePort = {
  withTenant: async () => { throw new Error("catalog must never access tenant tables"); },
  withoutTenant: async fn => asOwner(async c => {
    await c.query("SET LOCAL ROLE app_platform_org_catalog_ro");
    const session: TenantSession = { query: async <R>(sql: string, params?: readonly unknown[]) => ({ rows: (await c.query(sql, params ? [...params] : undefined)).rows as R[] }) };
    return fn(session);
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
  await asOwner(c => c.query("INSERT INTO organizations(id,name,kind) VALUES ($1,'plan empty','organization'),($2,'plan local','personal-local')",[EMPTY,LOCAL]));
  await addOrgMember(ORG,"member-5261","consultant",null);
});
afterAll(async () => { await resetOrgs(ORG,EMPTY,LOCAL); await db?.close(); });
describe("platform organization catalog and plan transactional boundary", () => {
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
