import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {toOrgId} from "../../../src/domain/org-id";
import type {IdentityRepository} from "../../../src/application/identity/ports";
import {PgOrgCoreModelRepository} from "../../../src/infrastructure/model/pg-org-core-model-repository";
import {PgDatabase} from "../../../src/infrastructure/db/pg-database";
import {appConfig} from "../../../src/infrastructure/db/pg-config";
import {asApp,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../../support/db";
const ORG="org-core-real-db",FOREIGN="org-core-foreign-db",MODEL="model-core-real-db";
const binding={modelId:MODEL,modelProvider:"fixture-provider",runtimeModelId:"fixture-runtime",configRevision:"fixture-price-v1",privateConnectionId:"fixture-connection"};
let db:PgDatabase,repo:PgOrgCoreModelRepository;
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 repo=new PgOrgCoreModelRepository(db,{resolve:async()=>binding},()=>({findOrgMembership:async()=>({orgRole:"admin"})}) as unknown as IdentityRepository);
});
beforeEach(async()=>{
 await resetOrgs(ORG,FOREIGN);await seedOrg({orgId:ORG,projectId:"project-core-real"});await seedOrg({orgId:FOREIGN,projectId:"project-core-foreign"});
 await asApp(ORG,c=>c.query(`INSERT INTO models(id,org_id,kind,shape,vendor,display_name,capability_tags,context_window,unit_price,compliance_attrs,status)
  VALUES($1,$2,'self-hosted','single','fixture','core-fixture','{}',100,0,'{}','已启用')`,[MODEL,ORG]));
});
afterAll(async()=>{await db?.close();await resetOrgs(ORG,FOREIGN);});
const input={expectedVersion:0,modelId:MODEL,actorId:"fixture-admin",reason:"Verified isolated fixture"};
describe("real DB core model selection boundaries",()=>{
 it("atomically persists selected binding and immutable revision",async()=>{
  expect(await repo.set(toOrgId(ORG),input)).toMatchObject({version:1,selection:binding});
  expect(await repo.read(toOrgId(ORG))).toMatchObject({version:1,selection:binding});
  const rows=await asApp(ORG,c=>c.query("SELECT version,config_revision FROM organization_core_model_changes WHERE org_id=$1",[ORG]));
  expect(rows.rows).toEqual([{version:1,config_revision:binding.configRevision}]);
 });
 it("two concurrent writes at the same version cannot both succeed",async()=>{
  const writes=await Promise.allSettled([repo.set(toOrgId(ORG),input),repo.set(toOrgId(ORG),input)]);
  expect(writes.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  const rejected=writes.find(result=>result.status==="rejected") as PromiseRejectedResult;
  expect(rejected.reason.message).toBe("VERSION_CHANGED");
  expect((await repo.read(toOrgId(ORG))).version).toBe(1);
 });
 it("RLS hides the other tenant and raw SQL cannot select a foreign formal model",async()=>{
  await repo.set(toOrgId(ORG),input);
  const hidden=await asApp(FOREIGN,c=>c.query("SELECT * FROM organization_core_models WHERE org_id=$1",[ORG]));expect(hidden.rows).toEqual([]);
  await expect(asApp(FOREIGN,c=>c.query(`INSERT INTO organization_core_models(org_id,version,model_id,model_provider,runtime_model_id,config_revision,private_connection_id,updated_by,reason)
   VALUES($1,1,$2,'fixture','runtime','revision','connection','actor','reason')`,[FOREIGN,MODEL]))).rejects.toThrow("ownership mismatch");
 });
 it("app and owner cannot rewrite audit; owner tenant teardown remains supported",async()=>{
  await repo.set(toOrgId(ORG),input);
  await expect(asApp(ORG,c=>c.query("UPDATE organization_core_model_changes SET reason='forged' WHERE org_id=$1",[ORG]))).rejects.toThrow();
  await expect(asOwner(c=>c.query("DELETE FROM organization_core_model_changes WHERE org_id=$1",[ORG]))).rejects.toThrow();
  await resetOrgs(ORG);
  expect((await asOwner(c=>c.query("SELECT * FROM organization_core_model_changes WHERE org_id=$1",[ORG]))).rows).toEqual([]);
 });
});
