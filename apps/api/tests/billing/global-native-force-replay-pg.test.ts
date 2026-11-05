import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asOwner,asApp,resetOrgs} from '../support/db';
import {migrate,migrationFiles} from '../../src/infrastructure/db/migrator';
import {nativeTariffForceReplay} from '../../src/infrastructure/db/native-tariff-force-replay';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {PgCreditConsumption} from '../../src/infrastructure/billing/pg-credit-consumption';
import {PgNativeCreditTariffRepository} from '../../src/infrastructure/billing/pg-native-credit-tariff-repository';
import {PgGlobalImageTariffRepository} from '../../src/infrastructure/billing/pg-global-image-tariff-repository';
import {createFixtureTariffWriter} from '../support/billing-tariff-writer';
import {toOrgId} from '../../src/domain/org-id';
const org=toOrgId('global-native-force-org'),model='force-'+randomUUID(),user='force-native-user-'+model,db=new PgDatabase(appConfig());
const file='20261022120000_credit_consumption.sql',raw=readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8');
const globalMigration=readFileSync(new URL('../../migrations/20261105170000_global_native_credit_tariffs.sql',import.meta.url),'utf8');
let writer:PgDatabase,repo:PgNativeCreditTariffRepository,beforeSnapshot:unknown;
const meter=new PgCreditConsumption(db),price={modelProvider:'force-fixture',modelId:model,unit:'image' as const,quantum:'1',hundredthsPerQuantum:'25',version:'old-retail'};
const digest=async()=>asOwner(async c=>({price:(await c.query('SELECT quantum::text,hundredths_per_quantum::text,version FROM credit_global_native_tariffs WHERE model_id=$1',[model])).rows,request:(await c.query('SELECT native_quantum::text,native_rate::text,tariff_version,reserved_hundredths::text FROM credit_consumption_requests WHERE request_id=ANY($1) ORDER BY request_id',[[model,model+'-image']])).rows,imageSchedule:(await c.query('SELECT * FROM credit_global_image_schedule')).rows,imageAudit:(await c.query('SELECT * FROM credit_global_image_tariff_changes ORDER BY id')).rows,audits:(await c.query("SELECT count(*)::integer AS count FROM credit_global_native_tariff_changes WHERE new_tariff->>'modelId'=$1",[model])).rows}));
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();writer=await createFixtureTariffWriter();repo=new PgNativeCreditTariffRepository(db,writer);
 await resetOrgs(org);await seedOrg({orgId:org,projectId:'global-force-workshop'});await addOrgMember(org,user,'admin',null);
 await repo.upsert('verified-test-maintenance',price);
 await asOwner(c=>c.query("INSERT INTO credit_native_tariffs_legacy(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES($1,$2,$3,'image',1,25,'stale-legacy-price')",[org,price.modelProvider,model]));
 await db.withTenant(org,s=>meter.reserveInSession(s,org,{requestId:model,userId:user,runId:null,executionAttemptId:null,projectId:null,modelProvider:price.modelProvider,modelId:model,startedAt:new Date().toISOString(),callPurpose:'native-image',nativeMaximum:{unit:'image',quantity:1n}}));
 await repo.upsert('verified-test-maintenance',{...price,hundredthsPerQuantum:'30',version:'new-retail'});
 const imageRepo=new PgGlobalImageTariffRepository(db,writer),current=await imageRepo.list();
 if(current.revision===null){const catalog=await repo.readCnyCatalog(org);await imageRepo.activate('verified-test-maintenance',{expectedRevision:null,expectedCatalogVersion:catalog.version});}
 await db.withTenant(org,s=>meter.reserveInSession(s,org,{requestId:model+'-image',userId:user,runId:null,executionAttemptId:null,projectId:null,modelProvider:'bailian-image',modelId:'qwen-image-3.0',startedAt:new Date().toISOString(),callPurpose:'native-image',nativeMaximum:{unit:'image',quantity:1n}}));
 beforeSnapshot=await digest();
});
afterAll(async()=>{await asOwner(c=>c.query('DELETE FROM credit_global_native_tariffs WHERE model_provider=$1 AND model_id=$2',['force-fixture',model]));await writer?.close();await db.close();await resetOrgs(org);});
// Two independently timed complete passes; this file is registered in the exclusive DDL lane.
it.each([1,2])('full force replay %s preserves current price/old frozen snapshot and default migration is a no-op',async()=>{
 const cfg=migrationConfig(),forced=await migrate(cfg,{force:true});
 expect(forced.applied).toHaveLength(migrationFiles().length);expect(await digest()).toEqual(beforeSnapshot);expect((await migrate(cfg)).applied).toEqual([]);
 expect(await asOwner(async c=>(await c.query('SELECT checksum FROM _kernel_migrations WHERE name=$1',[file])).rows[0].checksum)).toBe(createHash('sha256').update(raw).digest('hex'));
});
it('settles the original snapshot after both force passes without repricing it',async()=>{
 await db.withTenant(org,s=>meter.settleInSession(s,org,{eventId:model+'-image',userId:user,runId:null,modelProvider:'bailian-image',modelId:'qwen-image-3.0',tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:'not-applicable',outcome:'succeeded',nativeUsage:{unit:'image',quantity:0n,source:'reported'}}));
 await db.withTenant(org,s=>meter.settleInSession(s,org,{eventId:model,userId:user,runId:null,modelProvider:price.modelProvider,modelId:model,tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:'not-applicable',outcome:'succeeded',nativeUsage:{unit:'image',quantity:1n,source:'reported'}}));
 expect(await asOwner(async c=>(await c.query('SELECT debited_hundredths::text FROM credit_consumption_requests WHERE request_id=$1',[model])).rows[0])).toEqual({debited_hundredths:'25'});
});
it('ordinary or unrelated replay never rewrites SQL; complete cutover maps only bare relation tokens',async()=>{
 await asOwner(async c=>{
  expect(await nativeTariffForceReplay(c,file,raw,false)).toEqual({sql:raw,mapped:false});
  expect(await nativeTariffForceReplay(c,'another.sql',raw,true)).toEqual({sql:raw,mapped:false});
  const mapped=await nativeTariffForceReplay(c,file,raw,true);expect(mapped.mapped).toBe(true);expect(mapped.sql).toContain('CREATE TABLE IF NOT EXISTS credit_native_tariffs_legacy (');expect(mapped.sql).toContain('CREATE POLICY credit_native_tariffs_tenant ON credit_native_tariffs_legacy');
 });
});
it('partial cutover is refused rather than treated as an already applied migration',async()=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('ALTER TABLE credit_global_native_tariffs RENAME TO temporarily_missing_global_tariffs');
  await expect(c.query(globalMigration)).rejects.toThrow('global_native_tariff_cutover_incomplete');
 }finally{await c.query('ROLLBACK');}});
});
it('repeat migration validates permissions instead of silently skipping a corrupted cutover',async()=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('GRANT UPDATE ON credit_native_tariffs TO app_rw');
  await expect(c.query(globalMigration)).rejects.toThrow('global_native_tariff_cutover_invalid_permissions');
 }finally{await c.query('ROLLBACK');}});
 expect(await asApp(org,async c=>(await c.query("SELECT has_table_privilege('app_rw','credit_native_tariffs','UPDATE') AS allowed")).rows[0].allowed)).toBe(false);
});

it.each([
 'ALTER COLUMN quantum DROP NOT NULL',
 'ALTER COLUMN hundredths_per_quantum DROP NOT NULL',
 'ALTER COLUMN version DROP NOT NULL',
 'DROP CONSTRAINT credit_global_native_tariffs_quantum_check',
 'DROP CONSTRAINT credit_global_native_tariffs_hundredths_per_quantum_check',
 'DROP CONSTRAINT credit_global_native_tariffs_version_check',
])('refuses a partial financial table definition: %s',async alteration=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('ALTER TABLE credit_global_native_tariffs '+alteration);
  await expect(c.query(globalMigration)).rejects.toThrow(/global_native_tariff_cutover_invalid_(nullability|rate_constraints)/);
 }finally{await c.query('ROLLBACK');}});
});

it.each([
 'BEFORE UPDATE ON credit_global_native_tariff_changes FOR EACH ROW',
 'BEFORE UPDATE OR DELETE ON credit_global_native_tariff_changes FOR EACH ROW WHEN (false)',
 'BEFORE UPDATE OF old_tariff OR DELETE ON credit_global_native_tariff_changes FOR EACH ROW',
])('refuses a same-name/function weakened audit trigger: %s',async trigger=>{
 await asOwner(async c=>{await c.query('BEGIN');try{
  await c.query('DROP TRIGGER immutable_global_native_tariff_changes ON credit_global_native_tariff_changes');
  await c.query('CREATE TRIGGER immutable_global_native_tariff_changes '+trigger+' EXECUTE FUNCTION f159_token_usage_append_only()');
  await expect(c.query(globalMigration)).rejects.toThrow('global_native_tariff_cutover_invalid_audit_trigger');
 }finally{await c.query('ROLLBACK');}});
});
