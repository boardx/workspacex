// @global-scope-fixture table:credit_global_native_tariffs: each run owns a unique model key; owner cleanup deletes only that key.
// @global-scope-fixture table:credit_global_native_tariff_changes: append-only audit remains isolated by the unique model key.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp,asOwner,addOrgMember,resetOrgs} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgNativeCreditTariffRepository} from '../../src/infrastructure/billing/pg-native-credit-tariff-repository';
import {NativeCreditTariffService} from '../../src/application/billing/native-credit-tariff-service';
import {ConsumptionSettingsForbidden} from '../../src/application/billing/consumption-settings-service';
import {PgCreditConsumption} from '../../src/infrastructure/billing/pg-credit-consumption';
import {toOrgId} from '../../src/domain/org-id';
import {NativeCreditTariff} from '@repo/contracts/billing-consumption';
const unique=randomUUID(),org=toOrgId('native-credit-tariff-org'),personal=toOrgId('native-credit-tariff-personal'),fresh=toOrgId('native-credit-tariff-new');
const db=new PgDatabase(appConfig()),repo=new PgNativeCreditTariffRepository(db),service=new NativeCreditTariffService(repo,async u=>u==='tariff-operator');
const tariff={modelProvider:'global-native-fixture',modelId:unique,unit:'image' as const,quantum:'1',hundredthsPerQuantum:'25',version:'canonical-retail-v1',pricingBasis:{source:'operator' as const,retailSnapshotId:'canonical-retail-v1'}};
const principal={orgId:org,userId:'tariff-operator'},user='tariff-user-'+unique;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();await resetOrgs(org,personal,fresh);await seedOrg({orgId:org,projectId:'tariff-project'});await seedOrg({orgId:personal,kind:'personal-local',ownerUserId:user,projectId:'tariff-personal-project'});for(const id of [org,personal])await addOrgMember(id,user,'admin',null);});
afterAll(async()=>{await asOwner(c=>c.query('DELETE FROM credit_global_native_tariffs WHERE model_provider=$1 AND model_id=$2',[tariff.modelProvider,unique]));await db.close();await resetOrgs(org,personal,fresh);});
it('denies nonoperators before global read/write and rejects legacy org fields',async()=>{
 await expect(service.list({orgId:org,userId:'ordinary-member'})).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 await expect(service.upsert({orgId:org,userId:'ordinary-member'},tariff)).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 expect(NativeCreditTariff.safeParse({...tariff,orgId:org}).success).toBe(false);
});
it('personal and team calls share one global price but retain separate wallets and saved prices',async()=>{
 await service.upsert(principal,tariff);const store=new PgCreditConsumption(db);
 for(const id of [org,personal])await db.withTenant(id,s=>store.reserveInSession(s,id,{requestId:'global-tariff-'+id,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:unique,startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:'native-image',nativeMaximum:{unit:'image',quantity:1n}}));
 const next={...tariff,hundredthsPerQuantum:'30',version:'canonical-retail-v2',pricingBasis:{source:'operator' as const,retailSnapshotId:'canonical-retail-v2'}};
 await service.upsert(principal,next);
 for(const id of [org,personal]){
  const usage={eventId:'global-tariff-'+id,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:unique,tokensTotal:0,promptTokens:null,completionTokens:null,outcome:'succeeded' as const,totalSource:'not-applicable' as const,nativeUsage:{unit:'image' as const,quantity:1n,source:'reported' as const}};
  await db.withTenant(id,s=>store.settleInSession(s,id,usage));await store.reconcile(id,usage);
 }
 const records=await asOwner(async c=>(await c.query('SELECT wallet_id,native_rate::text,tariff_version,debited_hundredths::text,state FROM credit_consumption_requests WHERE request_id=ANY($1) ORDER BY request_id',[[org,personal].map(id=>'global-tariff-'+id)])).rows);
 expect(records).toHaveLength(2);expect(new Set(records.map(r=>r.wallet_id)).size).toBe(2);expect(records.every(r=>r.native_rate==='25'&&r.tariff_version===tariff.version&&r.debited_hundredths==='25'&&r.state==='settled')).toBe(true);
 const audits=await asApp(org,async c=>(await c.query("SELECT actor_id,old_tariff,new_tariff FROM credit_global_native_tariff_changes WHERE new_tariff->>'modelId'=$1 ORDER BY created_at,id",[unique])).rows);
 expect(audits).toHaveLength(2);expect(audits[0]).toMatchObject({actor_id:'tariff-operator',old_tariff:null,new_tariff:tariff});expect(audits[1]).toMatchObject({old_tariff:tariff,new_tariff:next});
 await expect(asApp(org,c=>c.query('DELETE FROM credit_global_native_tariff_changes'))).rejects.toThrow();
});
it('old runtime reads current global prices for existing and newly created orgs; old writes and legacy bypass fail',async()=>{
 await seedOrg({orgId:fresh,projectId:'tariff-new-project'});
 for(const id of [org,personal,fresh]){
  const read=await asApp(id,async c=>(await c.query('SELECT org_id,hundredths_per_quantum::text FROM credit_native_tariffs WHERE model_provider=$1 AND model_id=$2',[tariff.modelProvider,unique])).rows);
  expect(read).toEqual([{org_id:id,hundredths_per_quantum:'30'}]);
 }
 expect(await asApp(org,async c=>(await c.query('SELECT * FROM credit_native_tariffs WHERE org_id=$1',[fresh])).rows)).toEqual([]);
 for(const sql of ["UPDATE credit_native_tariffs SET quantum=999","DELETE FROM credit_native_tariffs","INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES('x','x','x','image',1,1,'x')","SELECT * FROM credit_native_tariffs_legacy","UPDATE credit_native_tariffs_legacy SET quantum=999"]){await expect(asApp(org,c=>c.query(sql))).rejects.toThrow();}
 expect((await repo.list()).find(row=>row.modelId===unique)?.hundredthsPerQuantum).toBe('30');
});
it('rejects malformed rates and unsupported units',()=>{
 for(const patch of [{quantum:'0'},{quantum:'1.5'},{hundredthsPerQuantum:'-1'},{hundredthsPerQuantum:'9999999999999999999'},{unit:'token'},{ownerId:'forged'}])expect(NativeCreditTariff.safeParse({...tariff,...patch}).success).toBe(false);
});
const migration=readFileSync(new URL('../../migrations/20261105090000_global_native_credit_tariffs.sql',import.meta.url),'utf8');
it('consolidates equivalent rational prices despite version metadata and rejects real price conflicts',async()=>{
 for(const conflicting of [false,true])await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('CREATE SCHEMA global_tariff_migration_fixture');await c.query('SET LOCAL search_path=global_tariff_migration_fixture,public');
  await c.query('CREATE TABLE credit_native_tariffs(org_id text,model_provider text,model_id text,unit text,quantum bigint,hundredths_per_quantum bigint,version text)');
  await c.query("INSERT INTO credit_native_tariffs VALUES('a','migration-provider','migration-model','image',1000,10,'old-v1'),('b','migration-provider','migration-model','image',2000,$1,'different-metadata')",[conflicting?21:20]);
  if(conflicting)await expect(c.query(migration)).rejects.toThrow('global_native_tariff_price_conflicts');
  else{await c.query(migration);expect((await c.query('SELECT quantum::text,hundredths_per_quantum::text,pricing_basis FROM credit_global_native_tariffs')).rows).toEqual([{quantum:'100',hundredths_per_quantum:'1',pricing_basis:{source:'legacy-consolidation',legacyRowCount:2,legacyVersionCount:2}}]);}
 }finally{await c.query('ROLLBACK');}});
});
