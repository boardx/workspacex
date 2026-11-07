import {beforeAll,afterAll,expect,it} from "vitest";
import {ensureDatabase,migrateOnce,asApp} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgConsumptionSettingsRepository} from "../../src/infrastructure/billing/pg-consumption-settings-repository";
import {ConsumptionSettingsService,ConsumptionSettingsForbidden} from "../../src/application/billing/consumption-settings-service";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId('credit-settings-pg-org'),db=new PgDatabase(appConfig());
const repo=new PgConsumptionSettingsRepository(db),service=new ConsumptionSettingsService(repo,async user=>user==='credit-settings-pg-operator');
beforeAll(async()=>{ensureDatabase();await migrateOnce();});afterAll(async()=>{try{await repo.update(org,"credit-settings-pg-cleanup",{creditPreflightEnabled:false});}finally{await db.close();}});
it('defaults OFF and atomically records an authorized policy change',async()=>{
 expect(await repo.read(org)).toEqual({creditPreflightEnabled:false,admissionPolicy:"personal_nonnegative_enterprise_overdraft"});
 await expect(service.update({orgId:org,userId:'credit-settings-pg-member'},{creditPreflightEnabled:true})).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 await service.update({orgId:org,userId:'credit-settings-pg-operator'},{creditPreflightEnabled:true});
 expect(await service.read({orgId:org,userId:'credit-settings-pg-member'})).toEqual({creditPreflightEnabled:true,admissionPolicy:"personal_nonnegative_enterprise_overdraft"});
 const audit=await asApp(org,async c=>(await c.query("SELECT actor_id,old_enabled,new_enabled FROM credit_consumption_setting_changes WHERE actor_id='credit-settings-pg-operator'")).rows);
 expect(audit).toEqual([{actor_id:'credit-settings-pg-operator',old_enabled:false,new_enabled:true}]);
});
it('keeps the audit immutable even for application database credentials',async()=>{
 await expect(asApp(org,async c=>c.query("UPDATE credit_consumption_setting_changes SET actor_id='forged' WHERE actor_id='credit-settings-pg-operator'"))).rejects.toThrow();
 await expect(asApp(org,async c=>c.query("DELETE FROM credit_consumption_setting_changes WHERE actor_id='credit-settings-pg-operator'"))).rejects.toThrow();
});
