// Global schedule writes use the audited repository; rejected direct SQL is an explicit permission counterexample.
// @global-scope-fixture table:credit_wallets: unique personal owner, isolated database teardown owns cleanup.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner,asApp} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,billingTariffWriterConfig} from '../../src/infrastructure/db/pg-config';
import {provisionBillingTariffWriter} from '../../scripts/provision-billing-tariff-writer';
import {PgGlobalImageTariffRepository} from '../../src/infrastructure/billing/pg-global-image-tariff-repository';
import {PgNativeCreditTariffRepository} from '../../src/infrastructure/billing/pg-native-credit-tariff-repository';
import {PgCreditConsumption} from '../../src/infrastructure/billing/pg-credit-consumption';
import {toOrgId} from '../../src/domain/org-id';
import {BILLING_ACCOUNTING_GENERATION as generation} from '../../src/domain/billing/billing-generation';
const prefix=`global-image-${randomUUID().slice(0,8)}`,user=`${prefix}-user`,personal=toOrgId(`${prefix}-personal`),team=toOrgId(`${prefix}-team`);
const reader=new PgDatabase(appConfig());let writer:PgDatabase,repo:PgGlobalImageTariffRepository;const credits=new PgCreditConsumption(reader);let catalogVersion:string;
const start=(id:string)=>({requestId:`${prefix}-${id}`,userId:user,runId:null,modelProvider:'bailian-image',modelId:'qwen-image-3.0',startedAt:new Date().toISOString(),executionAttemptId:null,projectId:null,maximumTokens:null,nativeMaximum:{unit:'image' as const,quantity:1n},callPurpose:'native-image' as const});
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();
 await provisionBillingTariffWriter('isolated-test-writer-password-6268');process.env.BILLING_TARIFF_DB_USER='app_billing_tariff_writer';process.env.BILLING_TARIFF_DB_PASSWORD='isolated-test-writer-password-6268';
 writer=new PgDatabase(billingTariffWriterConfig()!);repo=new PgGlobalImageTariffRepository(reader,writer);
 for(const org of [personal,team]){await seedOrg({orgId:org,projectId:`${org}-project`});await addOrgMember(org,user,'admin',null);}
 await asOwner(async c=>{
  await c.query('UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton',[generation]);
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by,billing_generation) VALUES($1,'enterprise',1,'operator',$2)",[team,generation]);
  await c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,20000),('team',$2,20000)",[user,team]);
 });
 catalogVersion=(await new PgNativeCreditTariffRepository(reader).readCnyCatalog(personal)).version;
});
afterAll(async()=>{await writer?.close();await reader.close();delete process.env.BILLING_TARIFF_DB_USER;delete process.env.BILLING_TARIFF_DB_PASSWORD;});
it('app identity cannot mutate global prices; provisioned password writer activates and audits atomically',async()=>{
 await expect(asApp(personal,c=>c.query("INSERT INTO credit_global_image_schedule(singleton,revision,catalog_version,schedule) VALUES(true,'forged','x','[1,2,3]')"))).rejects.toThrow();
 const schedule=await repo.activate('operator',{expectedRevision:null,expectedCatalogVersion:catalogVersion});expect(schedule.items).toHaveLength(3);
 await expect(repo.activate('operator',{expectedRevision:null,expectedCatalogVersion:catalogVersion})).rejects.toThrow();
 expect(await asOwner(async c=>(await c.query('SELECT count(*)::int n FROM credit_global_image_tariff_changes')).rows[0].n)).toBe(1);
 await expect(writer.withoutTenant(s=>s.query('DELETE FROM credit_global_image_tariff_changes'))).rejects.toThrow();
});
it('existing/new org rows are unnecessary and old markup cannot override either payer',async()=>{
 await asOwner(c=>c.query("INSERT INTO credit_native_tariffs_legacy(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES($1,'bailian-image','qwen-image-3.0','image',1,99999,'old-temporary-markup')",[personal]));
 const schedule=await repo.list();
 for(const [org,id,owner] of [[personal,'personal','user'],[team,'team','team']] as const)for(const row of schedule.items){
  const input={...start(row.modelId==='qwen-image-3.0'?id:`${id}-${row.modelId}`),modelId:row.modelId};
  await reader.withTenant(org,s=>credits.reserveInSession(s,org,input));
  expect(await asOwner(async c=>(await c.query('SELECT r.native_rate::text rate,w.owner_type FROM credit_consumption_requests r JOIN credit_wallets w USING(wallet_id) WHERE request_id=$1',[input.requestId])).rows[0])).toEqual({rate:row.hundredthsPerQuantum,owner_type:owner});
 }
 expect(await asApp(personal,async c=>(await c.query("SELECT count(*)::int n FROM credit_global_native_tariffs WHERE model_provider='bailian-image'")).rows[0].n)).toBe(0);
 expect(await asApp(personal,async c=>(await c.query("SELECT model_provider,model_id,unit FROM credit_native_tariffs GROUP BY model_provider,model_id,unit HAVING count(*)>1")).rows)).toEqual([]);
 await expect(reader.withTenant(personal,s=>credits.reserveInSession(s,personal,{...start('unknown'),modelId:'unknown'}))).rejects.toThrow('credit_native_tariff_missing');
});
it('a global price update leaves replay and settlement on the original snapshot with one debit',async()=>{
 const before=await repo.list(),oldRate=before.items.find(r=>r.modelId==='qwen-image-3.0')!.hundredthsPerQuantum;
 await asOwner(c=>c.query("UPDATE credit_packages SET total_credits=total_credits+100,base_credits=base_credits+100 WHERE enabled=true AND region='cn' AND product_kind='credit_topup'"));
 const newVersion=(await new PgNativeCreditTariffRepository(reader).readCnyCatalog(personal)).version;
 await expect(repo.activate('operator',{expectedRevision:before.revision,expectedCatalogVersion:catalogVersion})).rejects.toThrow();
 const updated=await repo.activate('operator',{expectedRevision:before.revision,expectedCatalogVersion:newVersion});expect(updated.revision).not.toBe(before.revision);
 const input=start('personal');await reader.withTenant(personal,s=>credits.reserveInSession(s,personal,input));
 const usage={eventId:input.requestId,userId:user,runId:null,modelProvider:input.modelProvider,modelId:input.modelId,tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:'not-applicable' as const,outcome:'succeeded' as const,nativeUsage:{unit:'image' as const,quantity:1n,source:'reported' as const}};
 await reader.withTenant(personal,s=>credits.settleInSession(s,personal,usage));await reader.withTenant(personal,s=>credits.settleInSession(s,personal,usage));
 expect(await asOwner(async c=>(await c.query('SELECT native_rate::text rate,state FROM credit_consumption_requests WHERE request_id=$1',[input.requestId])).rows[0])).toEqual({rate:oldRate,state:'settled'});
 const debit=await asApp(personal,async c=>(await c.query("SELECT count(*)::int n,sum(credits*100)::bigint::text hundredths FROM credit_transactions WHERE source_type='model_request' AND source_id=$1",[input.requestId])).rows[0]);
 expect(debit.n).toBe(1);expect(BigInt(debit.hundredths)).toBe(BigInt(oldRate));
});

it('database constraints reject malformed prices, duplicate models, zero rates and mixed bases through the actual writer',async()=>{
 const schedule=await repo.list();
 for(const items of [schedule.items.map((r,i)=>i?r:{...r,catalogVersion:null}),schedule.items.map((r,i)=>i?r:{...r,quantum:1}),schedule.items.map((r,i)=>i?r:{...r,customerAmountMinor:25}),schedule.items.map((r,i)=>i?r:{...r,customerAmountMinor:'100'}),[schedule.items[0],schedule.items[0],schedule.items[2]],schedule.items.map((r,i)=>i?r:{...r,hundredthsPerQuantum:'0'}),schedule.items.map((r,i)=>i?r:{...r,catalogVersion:'other'})]){
  await expect(writer.withoutTenant(s=>s.query('UPDATE credit_global_image_schedule SET schedule=$1::jsonb WHERE singleton',[JSON.stringify(items)]))).rejects.toThrow();
 }
});

it('writer rejects empty and oversized revision and basis values',async()=>{
 for(const column of ['revision','catalog_version'])for(const value of ['', 'x'.repeat(129)])await expect(writer.withoutTenant(s=>s.query(`UPDATE credit_global_image_schedule SET ${column}=$1 WHERE singleton`,[value]))).rejects.toThrow();
});

it('provisioning rejects both membership directions before granting login',async()=>{
 await asOwner(c=>c.query('CREATE ROLE global_tariff_test_group NOLOGIN'));
 for(const statement of ['GRANT global_tariff_test_group TO app_billing_tariff_writer','GRANT app_billing_tariff_writer TO app_rw']){
  await asOwner(c=>c.query(statement));
  try{await expect(provisionBillingTariffWriter('isolated-test-writer-password-6268')).rejects.toThrow('UNSAFE_WRITER_MEMBERSHIP');}
  finally{await asOwner(c=>c.query(statement.replace('GRANT','REVOKE').replace(' TO ',' FROM ')));}
 }
});

it('a newly created organization after activation reserves all three global models without organization tariffs',async()=>{
 const newOrg=toOrgId(`${prefix}-created-after-activation`);
 await seedOrg({orgId:newOrg,projectId:`${newOrg}-project`});await addOrgMember(newOrg,user,'admin',null);
 expect((await new PgNativeCreditTariffRepository(reader).list(newOrg)).every(row=>row.modelProvider!=='bailian-image')).toBe(true);
 expect(await asOwner(async c=>(await c.query('SELECT count(*)::int n FROM credit_native_tariffs_legacy WHERE org_id=$1',[newOrg])).rows[0].n)).toBe(0);
 const schedule=await repo.list();
 for(const row of schedule.items){
  const input={...start(`new-org-${row.modelId}`),modelId:row.modelId};
  await reader.withTenant(newOrg,s=>credits.reserveInSession(s,newOrg,input));
  expect(await asApp(newOrg,async c=>(await c.query('SELECT r.native_rate::text rate,r.tariff_version,w.owner_type,w.owner_id FROM credit_consumption_requests r JOIN credit_wallets w USING(wallet_id) WHERE r.request_id=$1',[input.requestId])).rows[0])).toEqual({rate:row.hundredthsPerQuantum,tariff_version:row.version,owner_type:'user',owner_id:user});
 }
});

it('catalog-derived runtime audit recognizes only the explicitly documented global pricing table',async()=>{
 const rows=await asApp(personal,async c=>(await c.query("SELECT table_name,verdict FROM kernel_tenant_table_audit('app_rw') WHERE table_name='credit_global_image_schedule' OR (verdict <> 'ok' AND verdict NOT LIKE 'exempt-%')")).rows);
 expect(rows).toEqual([{table_name:'credit_global_image_schedule',verdict:'exempt-declared-no-tenant-data'}]);
});

it('replaying the migration twice preserves the active schedule, immutable audit and frozen request snapshots',async()=>{
 const migration=await readFile(new URL('../../migrations/20261105160000_global_image_tariffs.sql',import.meta.url),'utf8');
 const snapshot=()=>asOwner(async c=>({
  schedule:(await c.query('SELECT * FROM credit_global_image_schedule')).rows,
  audit:(await c.query('SELECT * FROM credit_global_image_tariff_changes ORDER BY id')).rows,
  requests:(await c.query('SELECT * FROM credit_consumption_requests WHERE request_id LIKE $1 ORDER BY request_id',[`${prefix}%`])).rows,
 }));
 const before=await snapshot();expect(before.schedule).toHaveLength(1);expect(before.audit.length).toBeGreaterThan(0);expect(before.requests.length).toBeGreaterThan(0);
 for(let i=0;i<2;i++){await asOwner(c=>c.query(migration));expect(await snapshot()).toEqual(before);}
 await expect(asApp(personal,c=>c.query("UPDATE credit_global_image_schedule SET revision='forged'"))).rejects.toThrow();
 await expect(writer.withoutTenant(s=>s.query('DELETE FROM credit_global_image_tariff_changes'))).rejects.toThrow();
});
