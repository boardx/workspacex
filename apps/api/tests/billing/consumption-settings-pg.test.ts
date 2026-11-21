import {CREDIT_ADMISSION_POLICY} from "@repo/contracts/billing-consumption";
import {beforeAll,afterAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,asApp} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgConsumptionSettingsRepository} from "../../src/infrastructure/billing/pg-consumption-settings-repository";
import {ConsumptionSettingsService,ConsumptionSettingsForbidden} from "../../src/application/billing/consumption-settings-service";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId('credit-settings-pg-org'),db=new PgDatabase(appConfig());
const repo=new PgConsumptionSettingsRepository(db),service=new ConsumptionSettingsService(repo,async user=>user==='credit-settings-pg-operator');
beforeAll(async()=>{ensureDatabase();await migrateOnce();});afterAll(async()=>{try{await repo.update(org,"credit-settings-pg-cleanup",{creditPreflightEnabled:false,creditRateBps:null});}finally{await db.close();}});
it('defaults OFF and atomically records an authorized policy change',async()=>{
 expect(await repo.read(org)).toMatchObject({creditPreflightEnabled:false,admissionPolicy:CREDIT_ADMISSION_POLICY});
 await expect(service.update({orgId:org,userId:'credit-settings-pg-member'},{creditPreflightEnabled:true})).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 await service.update({orgId:org,userId:'credit-settings-pg-operator'},{creditPreflightEnabled:true});
 expect(await service.read({orgId:org,userId:'credit-settings-pg-member'})).toEqual({creditPreflightEnabled:true,admissionPolicy:CREDIT_ADMISSION_POLICY});
 const audit=await asApp(org,async c=>(await c.query("SELECT actor_id,old_enabled,new_enabled FROM credit_consumption_setting_changes WHERE actor_id='credit-settings-pg-operator'")).rows);
 expect(audit).toEqual([{actor_id:'credit-settings-pg-operator',old_enabled:false,new_enabled:true}]);
});
it('keeps the audit immutable even for application database credentials',async()=>{
 await expect(asApp(org,async c=>c.query("UPDATE credit_consumption_setting_changes SET actor_id='forged' WHERE actor_id='credit-settings-pg-operator'"))).rejects.toThrow();
 await expect(asApp(org,async c=>c.query("DELETE FROM credit_consumption_setting_changes WHERE actor_id='credit-settings-pg-operator'"))).rejects.toThrow();
});

it("persists an audited override, exposes the effective rate, and restores the deployment default", async () => {
 const operator = {orgId:org,userId:"credit-settings-pg-operator"};
 const inherited = await repo.read(org);
 try {
  const changed = await service.update(operator,{creditRateBps:12500});
  expect(changed).toMatchObject({creditRateBps:12500,effectiveCreditRateBps:12500});
  expect(await repo.read(org)).toEqual(changed);
  expect(changed.creditPreflightEnabled).toBe(inherited.creditPreflightEnabled);
  const audit = await asApp(org,async c => (await c.query(
   "SELECT old_credit_rate_bps,new_credit_rate_bps FROM credit_consumption_setting_changes WHERE new_credit_rate_bps=12500",
  )).rows);
  expect(audit).toContainEqual({old_credit_rate_bps:null,new_credit_rate_bps:12500});
 } finally {
  await service.update(operator,{creditRateBps:null});
 }
 expect(await repo.read(org)).toEqual(inherited);
});

it("keeps CN and US overrides independent", async () => {
 const operator = {orgId:org,userId:"credit-settings-pg-operator"};
 const before = (await repo.read(org)).marketRates;
 try {
  const cn = await service.update(operator,{market:"cn",creditRateBps:12000});
  expect(cn.marketRates).toEqual({cn:{overrideBps:12000,effectiveBps:12000},us:before?.us});
  const us = await service.update(operator,{market:"us",creditRateBps:13000});
  expect(us.marketRates).toEqual({cn:cn.marketRates?.cn,us:{overrideBps:13000,effectiveBps:13000}});
  const reset = await service.update(operator,{market:"cn",creditRateBps:null});
  expect(reset.marketRates).toEqual({cn:before?.cn,us:us.marketRates?.us});
 } finally {
  await service.update(operator,{market:"cn",creditRateBps:null});
  await service.update(operator,{market:"us",creditRateBps:null});
 }
});
