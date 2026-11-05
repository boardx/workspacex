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
import {NativeCreditTariff,CreditNativeUnit} from '@repo/contracts/billing-consumption';
import {BILLING_ACCOUNTING_GENERATION as generation} from '../../src/domain/billing/billing-generation';
import {createFixtureTariffWriter} from '../support/billing-tariff-writer';
const unique=randomUUID(),org=toOrgId('native-credit-tariff-org'),personal=toOrgId('native-credit-tariff-personal'),fresh=toOrgId('native-credit-tariff-new');
const db=new PgDatabase(appConfig());let writer:PgDatabase,repo:PgNativeCreditTariffRepository,service:NativeCreditTariffService;
const tariff={modelProvider:'dashscope',modelId:'qwen3-asr-flash-realtime',unit:'millisecond' as const,quantum:'4300',hundredthsPerQuantum:'33',version:'canonical-retail-'+unique,pricingBasis:{source:'operator' as const,retailSnapshotId:'canonical-retail-'+unique}};
const principal={orgId:org,userId:'tariff-operator'},user='tariff-user-'+unique;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();writer=await createFixtureTariffWriter();repo=new PgNativeCreditTariffRepository(db,writer);service=new NativeCreditTariffService(repo,async u=>u==='tariff-operator');await resetOrgs(org,personal,fresh);await seedOrg({orgId:org,projectId:'tariff-project'});await seedOrg({orgId:personal,kind:'personal-local',ownerUserId:user,projectId:'tariff-personal-project'});for(const id of [org,personal])await addOrgMember(id,user,'admin',null);await asOwner(async c=>{await c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton',[generation]);await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'fixture-operator',$2)",[org,generation]);});});
afterAll(async()=>{await asOwner(c=>c.query('DELETE FROM credit_global_native_tariffs WHERE model_provider=$1 AND model_id=$2',[tariff.modelProvider,tariff.modelId]));await writer?.close();await db.close();await resetOrgs(org,personal,fresh);});
it('denies nonoperators before global read/write and rejects legacy org fields',async()=>{
 await expect(service.list({orgId:org,userId:'ordinary-member'})).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 await expect(service.upsert({orgId:org,userId:'ordinary-member'},tariff)).rejects.toBeInstanceOf(ConsumptionSettingsForbidden);
 expect(NativeCreditTariff.safeParse({...tariff,orgId:org}).success).toBe(false);
});
it('personal and team calls share one global price but retain separate wallets and saved prices',async()=>{
 await service.upsert(principal,tariff);const store=new PgCreditConsumption(db);
 await seedOrg({orgId:fresh,projectId:'tariff-new-project'});await addOrgMember(fresh,user,'admin',null);await asOwner(c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'fixture-operator',$2)",[fresh,generation]));
 for(const id of [org,personal,fresh])await db.withTenant(id,s=>store.reserveInSession(s,id,{requestId:'global-tariff-'+id,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:tariff.modelId,startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:'native-asr',nativeMaximum:{unit:'millisecond',quantity:4300n}}));
 const next={...tariff,hundredthsPerQuantum:'44',version:tariff.version+'-next',pricingBasis:{source:'operator' as const,retailSnapshotId:tariff.version+'-next'}};
 await service.upsert(principal,next);
 for(const id of [org,personal,fresh]){
  const usage={eventId:'global-tariff-'+id,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:tariff.modelId,tokensTotal:0,promptTokens:null,completionTokens:null,outcome:'succeeded' as const,totalSource:'not-applicable' as const,nativeUsage:{unit:'millisecond' as const,quantity:4300n,source:'reported' as const}};
  await db.withTenant(id,s=>store.settleInSession(s,id,usage));await store.reconcile(id,usage);
 }
 const records=await asOwner(async c=>(await c.query('SELECT wallet_id,native_rate::text,tariff_version,debited_hundredths::text,state FROM credit_consumption_requests WHERE request_id=ANY($1) ORDER BY request_id',[[org,personal,fresh].map(id=>'global-tariff-'+id)])).rows);
 expect(records).toHaveLength(3);expect(new Set(records.map(r=>r.wallet_id)).size).toBe(3);expect(records.every(r=>r.native_rate==='33'&&r.tariff_version===tariff.version&&r.debited_hundredths==='33'&&r.state==='settled')).toBe(true);
 const audits=await asApp(org,async c=>(await c.query("SELECT actor_id,old_tariff,new_tariff FROM credit_global_native_tariff_changes WHERE new_tariff->>'modelId'=$1 AND new_tariff->>'version'=ANY($2) ORDER BY created_at,id",[tariff.modelId,[tariff.version,next.version]])).rows);
 expect(audits).toHaveLength(2);expect(audits[0]).toMatchObject({actor_id:'tariff-operator',old_tariff:null,new_tariff:tariff});expect(audits[1]).toMatchObject({old_tariff:tariff,new_tariff:next});
 await expect(asApp(org,c=>c.query('DELETE FROM credit_global_native_tariff_changes'))).rejects.toThrow();
});
it('old runtime reads current global prices for existing and newly created orgs; old writes and legacy bypass fail',async()=>{
 const store=new PgCreditConsumption(db),requestId='global-tariff-new-'+unique;
 await db.withTenant(fresh,s=>store.reserveInSession(s,fresh,{requestId,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:tariff.modelId,startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:'native-asr',nativeMaximum:{unit:'millisecond',quantity:4300n}}));
 const admitted=await asOwner(async c=>(await c.query('SELECT native_rate::text,tariff_version,reserved_hundredths::text FROM credit_consumption_requests WHERE request_id=$1',[requestId])).rows[0]);
 expect(admitted).toEqual({native_rate:'44',tariff_version:tariff.version+'-next',reserved_hundredths:'44'});
 expect(await asOwner(async c=>(await c.query('SELECT count(*)::integer AS count FROM credit_native_tariffs_legacy WHERE org_id=$1',[fresh])).rows[0].count)).toBe(0);
 await db.withTenant(fresh,s=>store.settleInSession(s,fresh,{eventId:requestId,userId:user,runId:null,modelProvider:tariff.modelProvider,modelId:tariff.modelId,tokensTotal:0,promptTokens:null,completionTokens:null,outcome:'succeeded',totalSource:'not-applicable',nativeUsage:{unit:'millisecond',quantity:0n,source:'reported'}}));
 for(const id of [org,personal,fresh]){
  const read=await asApp(id,async c=>(await c.query('SELECT org_id,hundredths_per_quantum::text FROM credit_native_tariffs WHERE model_provider=$1 AND model_id=$2',[tariff.modelProvider,tariff.modelId])).rows);
  expect(read).toEqual([{org_id:id,hundredths_per_quantum:'44'}]);
 }
 expect(await asApp(org,async c=>(await c.query('SELECT * FROM credit_native_tariffs WHERE org_id=$1',[fresh])).rows)).toEqual([]);
 for(const sql of ["UPDATE credit_native_tariffs SET quantum=999","DELETE FROM credit_native_tariffs","INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES('x','x','x','image',1,1,'x')","SELECT * FROM credit_native_tariffs_legacy","UPDATE credit_native_tariffs_legacy SET quantum=999"]){await expect(asApp(org,c=>c.query(sql))).rejects.toThrow();}
 expect((await repo.list()).find(row=>row.modelId===tariff.modelId)?.hundredthsPerQuantum).toBe('44');
});
it('rejects malformed rates and unsupported units',()=>{
 for(const patch of [{quantum:'0'},{quantum:'1.5'},{hundredthsPerQuantum:'-1'},{hundredthsPerQuantum:'9999999999999999999'},{unit:'token'},{ownerId:'forged'}])expect(NativeCreditTariff.safeParse({...tariff,...patch}).success).toBe(false);
});
it('app role cannot write global rows and the generic authority refuses every bailian unit',async()=>{
 await expect(asApp(org,c=>c.query("UPDATE credit_global_native_tariffs SET quantum=999"))).rejects.toThrow();
 for(const unit of CreditNativeUnit.options){
  expect(NativeCreditTariff.safeParse({...tariff,modelProvider:'bailian-image',unit}).success).toBe(false);
  await expect(writer.withoutTenant(s=>s.query("INSERT INTO credit_global_native_tariffs(model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES('bailian-image','qwen-image-3.0',$1,1,1,'forged')",[unit]))).rejects.toThrow();
 }
 await expect(new PgNativeCreditTariffRepository(db).upsert('operator',tariff)).rejects.toThrow();
 await expect(repo.upsert('operator',{...tariff,orgId:org} as never)).rejects.toThrow();
 const meter=new PgCreditConsumption(db);
 await expect(db.withTenant(org,s=>meter.reserveInSession(s,org,{requestId:'unpriced-'+unique,userId:user,runId:null,modelProvider:'dashscope',modelId:'unconfigured-'+unique,startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,callPurpose:'native-asr',nativeMaximum:{unit:'millisecond',quantity:1n}}))).rejects.toThrow('credit_native_tariff_missing');
});
const migration=readFileSync(new URL('../../migrations/20261105170000_global_native_credit_tariffs.sql',import.meta.url),'utf8');
it('consolidates equivalent rational prices despite version metadata and rejects real price conflicts',async()=>{
 for(const conflicting of [false,true])await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('CREATE SCHEMA global_tariff_migration_fixture');await c.query('SET LOCAL search_path=global_tariff_migration_fixture,public');
  await c.query('CREATE TABLE credit_native_tariffs(org_id text,model_provider text,model_id text,unit text,quantum bigint,hundredths_per_quantum bigint,version text)');
  await c.query("INSERT INTO credit_native_tariffs VALUES('a','migration-provider','migration-model','image',1000,10,'old-v1'),('b','migration-provider','migration-model','image',2000,$1,'different-metadata')",[conflicting?21:20]);
  if(conflicting)await expect(c.query(migration)).rejects.toThrow('global_native_tariff_price_conflicts');
  else{await c.query(migration);expect((await c.query('SELECT quantum::text,hundredths_per_quantum::text,pricing_basis FROM credit_global_native_tariffs')).rows).toEqual([{quantum:'100',hundredths_per_quantum:'1',pricing_basis:{source:'legacy-consolidation',legacyRowCount:2,legacyVersionCount:2}}]);}
 }finally{await c.query('ROLLBACK');}});
});
it('fails migration instead of silently copying zero rows under forced RLS',async()=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('CREATE SCHEMA global_tariff_rls_fixture');await c.query('GRANT USAGE,CREATE ON SCHEMA global_tariff_rls_fixture TO app_rw');await c.query('SET LOCAL search_path=global_tariff_rls_fixture,public');
  await c.query('CREATE TABLE credit_native_tariffs(org_id text,model_provider text,model_id text,unit text,quantum bigint,hundredths_per_quantum bigint,version text)');
  await c.query("INSERT INTO credit_native_tariffs VALUES('hidden','rls-provider','rls-model','image',1,1,'v1')");
  await c.query('ALTER TABLE credit_native_tariffs OWNER TO app_rw');await c.query('ALTER TABLE credit_native_tariffs ENABLE ROW LEVEL SECURITY');await c.query('ALTER TABLE credit_native_tariffs FORCE ROW LEVEL SECURITY');
  await c.query('CREATE POLICY hide ON credit_native_tariffs USING(false)');await c.query('SET LOCAL ROLE app_rw');
  await expect(c.query(migration)).rejects.toThrow(/row.level security/i);
 }finally{await c.query('ROLLBACK');}});
});
