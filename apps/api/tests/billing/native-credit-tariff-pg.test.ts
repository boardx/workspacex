import {beforeAll,afterAll,it,expect} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgNativeCreditTariffRepository} from '../../src/infrastructure/billing/pg-native-credit-tariff-repository';
import {NativeCreditTariffService} from '../../src/application/billing/native-credit-tariff-service';
import {ConsumptionSettingsForbidden} from '../../src/application/billing/consumption-settings-service';
import {toOrgId} from '../../src/domain/org-id';
import {NativeCreditTariff} from '@repo/contracts/billing-consumption';
const org=toOrgId('native-credit-tariff-org'),other=toOrgId('native-credit-tariff-other'),db=new PgDatabase(appConfig());
const repo=new PgNativeCreditTariffRepository(db),service=new NativeCreditTariffService(repo,async u=>u==='tariff-operator');
const tariff={orgId:String(org),modelProvider:'openai',modelId:'image-model',unit:'image' as const,quantum:'1',hundredthsPerQuantum:'25',version:'price-v1'};
beforeAll(async()=>{ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:'tariff-project'});await seedOrg({orgId:other,projectId:'tariff-other-project'});});
afterAll(async()=>db.close());
it('only an operator may list or persist prices',async()=>{
 const member={orgId:org,userId:'ordinary-member'};
 await expect(service.list(member,org)).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 await expect(service.upsert(member,tariff)).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 expect(await repo.list(org)).toEqual([]);
});
it('round trips exact rates with isolated tenant results and immutable audit',async()=>{
 await service.upsert({orgId:org,userId:'tariff-operator'},tariff);
 expect(await repo.list(org)).toEqual([tariff]);expect(await repo.list(other)).toEqual([]);
 const next={...tariff,hundredthsPerQuantum:'30',version:'price-v2'};await service.upsert({orgId:org,userId:'tariff-operator'},next);
 const rows=await asApp(org,async c=>(await c.query('SELECT actor_id,old_tariff,new_tariff FROM credit_native_tariff_changes WHERE org_id=$1 ORDER BY created_at,id',[org])).rows);
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({actor_id:'tariff-operator',old_tariff:null,new_tariff:tariff});expect(rows[1]).toMatchObject({old_tariff:tariff,new_tariff:next});
 await expect(asApp(org,async c=>c.query('DELETE FROM credit_native_tariff_changes WHERE org_id=$1',[org]))).rejects.toThrow();
});
it('rejects zero, fractional, overflowing rates and unknown native units',()=>{
 for(const patch of [{quantum:'0'},{quantum:'1.5'},{hundredthsPerQuantum:'-1'},{hundredthsPerQuantum:'9999999999999999999'},{unit:'token'},{ownerId:'forged'}])expect(NativeCreditTariff.safeParse({...tariff,...patch}).success).toBe(false);
});
