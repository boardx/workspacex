// @global-scope-fixture table:credit_transactions: tariff-replay UUID row exists only inside the replay test transaction and is always rolled back in finally.
// Repository calls own one unique model key per run; cleanup removes only that exact global key.
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
it('new organizations consume canonical prices with no old tariff storage',async()=>{
 await seedOrg({orgId:fresh,projectId:'tariff-new-project'});await addOrgMember(fresh,user,'admin',null);
 const store=new PgCreditConsumption(db),requestId='global-tariff-new-'+unique;
 await db.withTenant(fresh,s=>store.reserveInSession(s,fresh,{requestId,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:unique,startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:'native-image',nativeMaximum:{unit:'image',quantity:1n}}));
 const admitted=await asOwner(async c=>(await c.query('SELECT native_rate::text,tariff_version,reserved_hundredths::text FROM credit_consumption_requests WHERE request_id=$1',[requestId])).rows[0]);
 expect(admitted).toEqual({native_rate:'30',tariff_version:'canonical-retail-v2',reserved_hundredths:'30'});
 await db.withTenant(fresh,s=>store.settleInSession(s,fresh,{eventId:requestId,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:unique,tokensTotal:0,promptTokens:null,completionTokens:null,outcome:'succeeded',totalSource:'not-applicable',nativeUsage:{unit:'image',quantity:0n,source:'reported'}}));
 expect(await asOwner(async c=>(await c.query("SELECT to_regclass('credit_native_tariffs') AS old,to_regclass('credit_native_tariff_changes') AS old_audit,to_regclass('credit_native_tariffs_legacy') AS legacy")).rows[0])).toEqual({old:null,old_audit:null,legacy:null});
 expect((await repo.list()).find(row=>row.modelId===unique)?.hundredthsPerQuantum).toBe('30');
});
it('rejects malformed rates and unsupported units',()=>{
 for(const patch of [{quantum:'0'},{quantum:'1.5'},{hundredthsPerQuantum:'-1'},{hundredthsPerQuantum:'9999999999999999999'},{unit:'token'},{ownerId:'forged'}])expect(NativeCreditTariff.safeParse({...tariff,...patch}).success).toBe(false);
});
const migration=readFileSync(new URL('../../migrations/20261105090000_global_native_credit_tariffs.sql',import.meta.url),'utf8');
it('replays global tariff cleanup without rewriting prices, history, newer ledger rows, or privileges',async()=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  // A valid post-consumption-migration type reproduces the populated CI ledger.
  // Replaying unrelated historical DDL here used to narrow its CHECK and fail23514.
  const ledger=await c.query("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) SELECT wallet_id,'subscription_expire',-1,1,0,'subscription_period',$1 FROM credit_wallets WHERE owner_type='team' AND owner_id=$2 RETURNING to_jsonb(credit_transactions) AS row",['tariff-replay-'+unique,org]);
  expect(ledger.rows).toHaveLength(1);
  const snapshot=async()=> (await c.query(`SELECT
   (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY model_provider,model_id,unit),'[]') FROM credit_global_native_tariffs t) AS prices,
   (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM credit_global_native_tariff_changes t) AS audit`)).rows[0];
  const before=await snapshot();
  expect(before.prices.length).toBeGreaterThan(0);
  expect(before.audit.length).toBeGreaterThan(0);
  for(let round=0;round<2;round++){
   // Only the obsolete relations touched by this migration are fixtures. Full
   // ordered history replay belongs to migrate:check, not a shared populated DB.
   await c.query("CREATE TABLE credit_native_tariffs(org_id text,model_provider text,model_id text,unit text,quantum bigint,hundredths_per_quantum bigint,version text)");
   await c.query("CREATE TABLE credit_native_tariff_changes(org_id text,actor_id text,new_tariff jsonb)");
   await c.query("INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES($1,'discarded-test-data','obsolete','image',1,999,'obsolete')",[org]);
   await c.query("INSERT INTO credit_native_tariff_changes(org_id,actor_id,new_tariff) VALUES($1,'discarded-test-data','{}')",[org]);
   await c.query(migration);
   expect(await snapshot()).toEqual(before);
   expect((await c.query("SELECT to_jsonb(credit_transactions) AS row FROM credit_transactions WHERE source_id=$1",['tariff-replay-'+unique])).rows).toEqual(ledger.rows);
   expect((await c.query(`SELECT
    to_regclass('credit_native_tariffs') AS old,
    to_regclass('credit_native_tariff_changes') AS old_audit,
    to_regclass('credit_native_tariffs_legacy') AS legacy,
    has_table_privilege('app_rw','credit_global_native_tariff_changes','UPDATE,DELETE') AS audit_mutable`)).rows[0])
    .toEqual({old:null,old_audit:null,legacy:null,audit_mutable:false});
  }
 }finally{await c.query('ROLLBACK');}});
});
