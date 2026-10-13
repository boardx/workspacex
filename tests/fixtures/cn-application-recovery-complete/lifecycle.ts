/** Full control application schema + isolated migration transaction and A-route.
 * Control checkout, NOT exact f0eb or baseline image acceptance.
 */
import assert from 'node:assert/strict';
import {transactionFault}from'./transaction';
import {withCompleteController}from'./controller';
import fs from 'node:fs/promises';
import {writeFileSync}from'node:fs';
import {startupDiagnostic}from'../cn-api-startup/diagnostic';
import {mark,markConstraintRoundtrip}from'./diagnostic';
import {assertCatalogEqual}from'./catalog-assert';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire}from'node:module';
import {execFile}from'node:child_process';
import {promisify,isDeepStrictEqual}from'node:util';
import {migrate,migrationFiles,MIGRATIONS_DIR}from'../../../apps/api/src/infrastructure/db/migrator';
import {PgDatabase}from'../../../apps/api/src/infrastructure/db/pg-database';
import {PgIdentityRepository}from'../../../apps/api/src/infrastructure/identity/pg-identity-repository';
import {toOrgId}from'../../../apps/api/src/domain/org-id';
const pg=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('pg');
const catalog=createRequire(import.meta.url)('../../../.harness/scripts/vm/cn_restore_catalog.cjs');
const exec=promisify(execFile),configFile=path.resolve(process.argv[2]),root=path.dirname(configFile),cfg=JSON.parse(await fs.readFile(configFile,'utf8'));
process.on('uncaughtException',(error)=>{try{writeFileSync(path.join(root,'failure-diagnostic.json'),JSON.stringify(startupDiagnostic(error)),{flag:'wx',mode:0o600});}finally{process.exit(1);}});
assert.equal(cfg.host,path.join(root,'socket'));assert.equal(cfg.user,'fixture_owner');assert.equal(cfg.database,'postgres');assert.match(path.basename(root),/^wsx-pg-fixture-/);
assert.match(cfg.containerId,/^[a-f0-9]{64}$/);assert.match(cfg.ownerToken,/^[a-f0-9]{32}$/);
const phases=['init','backup','restore','compatibility','migration-fault','startup-fault','postclear-fault','finalize'];
const mode=process.argv[3],phase=process.argv[4];assert(['--phase','--observe'].includes(mode)&&phases.includes(phase));
const seed=cfg.seed;assert(Number.isSafeInteger(seed)&&seed>=0);const hash=(x:string|Buffer)=>crypto.createHash('sha256').update(x).digest('hex');
const stateFile=path.join(root,'application-state.json'),journal=path.join(root,'application-journal'),dump=path.join(root,'original-epoch.dump');
async function syncDir(dir:string){const f=await fs.open(dir,'r');try{await f.sync();}finally{await f.close();}}
async function once(file:string,value:unknown){const f=await fs.open(file,'wx',0o600);try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}await syncDir(path.dirname(file));}
async function rawOnce(file:string,value:Buffer){const f=await fs.open(file,'wx',0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}await syncDir(path.dirname(file));}
let state:any;
try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e:any){assert.equal(e.code,'ENOENT');assert.equal(phase,'init');assert.equal(mode,'--phase');await fs.mkdir(journal,{mode:0o700});state={epoch:crypto.randomUUID(),seed,finished:[],events:[],checks:[],originalEpochRetired:false};}
assert.equal(state.seed,seed);
const dbcfg=(database:string,user='fixture_owner')=>({host:cfg.host,port:5432,database,user,password:user==='app_rw'?'app_rw_dev':'',connectionTimeoutMillis:10000,statement_timeout:85000});
async function query(db:string,sql:string,args:unknown[]=[],user='fixture_owner'){const c=new pg.Client(dbcfg(db,user));await c.connect();try{return(await c.query(sql,args)).rows;}finally{await c.end();}}
async function actualRead(db:string){const database=new PgDatabase(dbcfg(db,'app_rw'));try{return await new PgIdentityRepository(database).findOrganization(toOrgId('org-app-recovery'));}finally{await database.close();}}
async function event(stage:string,observed:unknown){const previous=state.events.at(-1)?.sha256??null;const value={kind:'synthetic-pg-lifecycle-event-v1',epoch:state.epoch,seed,stage,previousSha256:previous,observed};const raw=Buffer.from(JSON.stringify(value)+'\n');const name=String(state.events.length).padStart(3,'0')+'-'+stage+'.json';await rawOnce(path.join(journal,name),raw);state.events.push({name,sha256:hash(raw)});}
async function ledger(db:string){return query(db,'SELECT name,checksum FROM _kernel_migrations ORDER BY name');}
async function hold(db:string){await query(db,'REVOKE INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public FROM app_rw');await query(db,'REVOKE USAGE,UPDATE ON ALL SEQUENCES IN SCHEMA public FROM app_rw');await query(db,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND usename='app_rw'",[db]);await held(db);}
async function held(db:string){assert.equal((await query(db,"SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND usename='app_rw'",[db]))[0].n,0);await assert.rejects(query(db,"UPDATE cn_recovery_canary SET value='unauthorized'",[],'app_rw'),(e:any)=>e.code==='42501');}
async function checkContainer(){
 // The original daemon identity is rechecked for each backup/restore command.
 const inspected=JSON.parse((await exec('docker',['inspect',cfg.containerId],{timeout:15000,maxBuffer:65536})).stdout)[0];
 assert.equal(inspected.Config.Labels['cn-startup-fixture'],cfg.ownerToken);assert.equal(inspected.Image,cfg.imageId);assert.equal(inspected.Id,cfg.containerId);
}
async function dockerTool(tool:string,args:string[]){await checkContainer();
 return exec('docker',['exec',cfg.containerId,'timeout','85s',tool,'-U','fixture_owner',...args],{timeout:90000,maxBuffer:64*1024*1024,encoding:'buffer',env:{PATH:process.env.PATH!,LANG:'C.UTF-8'}});
}
async function catalogFacts(db:string){const c=new pg.Client(dbcfg(db));await c.connect();try{await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL search_path='pg_catalog'");const facts=await catalog.collectFacts(c,['fixture_owner','app_rw','app_diag_ro']);await c.query('ROLLBACK');return facts;}finally{await c.end();}}
async function constraintPretty(db:string){return query(db,"SELECT conname,pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE conname=ANY($1::text[]) ORDER BY conname",[['organization_core_models_fields_check','project_tags_tag_check']]);}
async function backup(destination=dump){await held('app_epoch');const result=await dockerTool('pg_dump',['-Fc','app_epoch']);assert(result.stdout.length>0&&result.stdout.length<=64*1024*1024);await rawOnce(destination,result.stdout);const meta={sha256:hash(result.stdout),bytes:result.stdout.length};if(destination===dump){state.dumpSha256=meta.sha256;state.dumpBytes=meta.bytes;}return meta;}
async function restore(db:string,archive=dump,archiveSha=state.dumpSha256){assert.equal(state.originalEpochRetired,false,'OLD_EPOCH_RESTORE_FORBIDDEN');assert.match(db,/^app_[a-z_]+$/);const bytes=await fs.readFile(archive);assert.equal(hash(bytes),archiveSha);
 await checkContainer();await query('postgres','CREATE DATABASE '+db);
 // Feed only this exact saved dump via stdin, never dump the mutated source.
 await new Promise<void>((resolve,reject)=>{import('node:child_process').then(({spawn})=>{
  const child=spawn('docker',['exec','-i',cfg.containerId,'timeout','85s','pg_restore','-U','fixture_owner','--exit-on-error','--single-transaction','--dbname='+db],{stdio:['pipe','ignore','pipe'],env:{PATH:process.env.PATH!,LANG:'C.UTF-8'}});
  let errors=0;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('RESTORE_TIMEOUT'));},90000);
  child.stderr.on('data',(chunk:Buffer)=>{errors+=chunk.length;if(errors>65536){child.kill('SIGKILL');reject(Error('RESTORE_OUTPUT_LIMIT'));}});
  child.on('error',reject);child.stdin.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('RESTORE_FAILED'));});child.stdin.end(bytes);
 });});
 // Preserve original owners/ACLs in the same isolated cluster, then compare all original catalog categories.
 mark('restore-ledger');await hold(db);assert(isDeepStrictEqual(await ledger(db),state.originalLedger),'RESTORE_LEDGER_MISMATCH');
 mark('restore-repository');assert(isDeepStrictEqual(await actualRead(db),state.applicationReadback),'RESTORE_REPOSITORY_MISMATCH');
 mark('restore-canary');assert(isDeepStrictEqual(await query(db,'TABLE cn_recovery_canary'),state.canary),'RESTORE_CANARY_MISMATCH');
 mark('restore-catalog');const restoredCatalog=await catalogFacts(db);
 const pretty=await constraintPretty(db);markConstraintRoundtrip({prettyDefinitionsEqual:isDeepStrictEqual(pretty,state.originalPrettyConstraints),originalPrettySha256:hash(JSON.stringify(state.originalPrettyConstraints)),restoredPrettySha256:hash(JSON.stringify(pretty)),sourceCount:state.originalPrettyConstraints.length,targetCount:pretty.length});
 // Compare the entire original catalog without constructing an unbounded
 // AssertionError diff of full application schema/data on a failed comparison.
 assertCatalogEqual(restoredCatalog,state.originalCatalog);
 await event('isolated-restore',{database:db,originalDumpSha256:archiveSha,ledgerSha256:hash(JSON.stringify(await ledger(db))),actualRepository:'PgIdentityRepository.findOrganization',holdRetained:true});
}
async function readPhase(p:string){const raw=await fs.readFile(path.join(journal,p+'.result.json'));const v=JSON.parse(raw.toString());assert.equal(v.epoch,state.epoch);assert.equal(v.seed,seed);assert.equal(v.phase,p);assert.equal(v.verified,true);for(const item of v.journalRecords){const bytes=await fs.readFile(path.join(journal,item.name));assert.equal(hash(bytes),item.sha256);assert.equal(bytes.toString('base64'),item.rawBase64);}return{raw,value:v};}
if(mode==='--observe'){process.stdout.write((await readPhase(phase)).raw);process.exit(0);}
assert.equal(phases[state.finished.length],phase);const intent=path.join(journal,phase+'.intent.json');await once(intent,{epoch:state.epoch,phase,seed});const begin=state.events.length;
mark(phase);
if(phase==='init'){
 mark('initial-migrations');
 const names=migrationFiles();assert(names.length>=416);state.fullCount=names.length;state.originalCount=names.length;
 const manifest=[];for(const name of names){const raw=await fs.readFile(path.join(MIGRATIONS_DIR,name));manifest.push({name,sha256:hash(raw)});}
 await once(path.join(root,'original-migration-manifest.json'),manifest);state.migrationManifestSha256=hash(await fs.readFile(path.join(root,'original-migration-manifest.json')));
 await query('postgres','CREATE DATABASE app_epoch');const applied=await migrate(dbcfg('app_epoch'));assert.equal(applied.applied.length,state.originalCount);assert.equal(applied.skipped.length,0);
 await query('app_epoch',"INSERT INTO organizations(id,name,kind) VALUES('org-app-recovery','Current epoch application fixture','organization')");
 await query('app_epoch',"CREATE TABLE cn_recovery_canary(value text);INSERT INTO cn_recovery_canary VALUES('original-current-epoch');GRANT SELECT,INSERT,UPDATE,DELETE ON cn_recovery_canary TO app_rw");
 state.applicationReadback=await actualRead('app_epoch');assert.equal(state.applicationReadback?.name,'Current epoch application fixture');state.canary=await query('app_epoch','TABLE cn_recovery_canary');await hold('app_epoch');
 mark('initial-catalog');state.originalCatalog=await catalogFacts('app_epoch');state.originalPrettyConstraints=await constraintPretty('app_epoch');state.originalLedger=await ledger('app_epoch');await once(path.join(root,'original-ledger.json'),state.originalLedger);
 await event('original-app-prefix-held',{migrationCount:state.originalCount,fullApplicationMigrationCount:names.length,ledgerSha256:hash(JSON.stringify(state.originalLedger)),fullControlSchemaFixture:true,holdRetained:true});
 state.checks.push('original_application_prefix_migrations_and_actual_repository');
}else if(phase==='backup'){await held('app_epoch');await backup();await event('current-epoch-backup',{sha256:state.dumpSha256,bytes:state.dumpBytes,epoch:state.epoch});
}else if(phase==='restore'){await restore('app_preflight_restore');state.checks.push('same_original_backup_preflight_restore_actual_repository');
}else if(phase==='compatibility'){
 const actorRoot='/tmp/wsx-postclear-'+crypto.randomUUID().replaceAll('-','');await fs.mkdir(actorRoot,{mode:0o700});
 try{state.aRoute=await withCompleteController(actorRoot,cfg.python,{held:()=>held('app_epoch'),capture:async()=>{state.routeDump=await backup(path.join(root,'route-epoch.dump'));return state.routeDump.sha256;},rehearse:()=>restore('app_route_rehearsal',path.join(root,'route-epoch.dump'),state.routeDump.sha256),migrate:async()=>{state.transaction=await transactionFault(dbcfg('app_route_rehearsal'),root);},readback:async()=>{assert.deepEqual(await actualRead('app_route_rehearsal'),state.applicationReadback);}});}finally{await fs.rm(actorRoot,{recursive:true,force:true});}
 await event('full-schema-original-route-completed',{dumpSha256:state.dumpSha256,aRoute:state.aRoute,routeDump:state.routeDump,transaction:state.transaction});state.checks.push('full_schema_original_factory_hold_backup_rehearsal_transaction_readback_clear');
}else if(phase==='migration-fault'){
 const actorRoot='/tmp/wsx-postclear-'+crypto.randomUUID().replaceAll('-','');await fs.mkdir(actorRoot,{mode:0o700});
 try{state.holdDrift=await withCompleteController(actorRoot,cfg.python,{held:()=>held('app_epoch'),capture:async()=>{assert.equal(hash(await fs.readFile(dump)),state.dumpSha256);return state.dumpSha256;},rehearse:async()=>{throw Error('DRIFT_MUST_PREVENT_RESTORE');},migrate:async()=>{throw Error('DRIFT_MUST_PREVENT_DDL');},readback:async()=>{throw Error('DRIFT_MUST_PREVENT_READBACK');}},true);}finally{await fs.rm(actorRoot,{recursive:true,force:true});}
 await restore('app_partial_recovered');await event('actual-generation-drift-rejected',{dumpSha256:state.dumpSha256,holdDrift:state.holdDrift});state.checks.push('fresh_hold_generation_rejects_before_migration_same_dump_restores');
}else if(phase==='startup-fault'){
 // Explicit injected post-read startup boundary, not actual startApi coverage.
 await assert.rejects(async()=>{assert.deepEqual(await actualRead('app_preflight_restore'),state.applicationReadback);throw Error('INJECTED_AFTER_REPOSITORY_READ');},/^Error: INJECTED_AFTER_REPOSITORY_READ$/);await held('app_epoch');await restore('app_startup_recovered');
 await event('injected-startup-fault',{boundary:'fixture-after-real-repository-read',actualStartApiTested:false,holdRetained:true});state.checks.push('startup_boundary_fixture_original_dump_recovery');
}else if(phase==='postclear-fault'){
 await query('app_preflight_restore',"GRANT UPDATE ON cn_recovery_canary TO app_rw");await query('app_preflight_restore',"UPDATE cn_recovery_canary SET value='new-writer-epoch'",[],'app_rw');await hold('app_preflight_restore');
 const newRows=await query('app_preflight_restore','TABLE cn_recovery_canary');assert.notDeepEqual(newRows,state.canary);state.originalEpochRetired=true;await assert.rejects(restore('app_postclear_recovered'),/OLD_EPOCH_RESTORE_FORBIDDEN/);assert.deepEqual(await query('app_preflight_restore','TABLE cn_recovery_canary'),newRows);assert.equal((await query('postgres',"SELECT count(*)::int n FROM pg_database WHERE datname='app_postclear_recovered'"))[0].n,0);
 await event('new-epoch-restore-refused',{holdRetained:true,newWriterEpoch:true,restoreDispatched:false});state.checks.push('new_writes_do_not_authorize_old_epoch_restore');
}else{
 assert.equal(hash(await fs.readFile(dump)),state.dumpSha256);await held('app_epoch');assert.deepEqual(await actualRead('app_partial_recovered'),state.applicationReadback);state.checks.push('original_dump_bytes_and_real_application_readback_preserved');
 await event('finalize',{holdRetained:true,actualRepository:true,productionAccepted:false});
}
state.finished.push(phase);const tmp=stateFile+'.'+phase;await once(tmp,state);await fs.rename(tmp,stateFile);await syncDir(root);
const records=[];for(const item of state.events.slice(begin)){const raw=await fs.readFile(path.join(journal,item.name));records.push({...item,rawBase64:raw.toString('base64')});}
const previous=state.finished.length>1?hash((await readPhase(state.finished.at(-2))).raw):null;
const summary=phase==='finalize'?{verified:true,seed,tests:state.checks,epoch:state.epoch,backupSha256:state.dumpSha256,backupBytes:state.dumpBytes,originalMigrationCount:state.originalCount,fullApplicationMigrationCount:state.fullCount,migrationManifestSha256:state.migrationManifestSha256,actualApplicationMigrator:true,businessLayer:'actual-PgIdentityRepository-readback',actualStartApiTested:false,fullControlSchemaFixture:true,oldVersionImageTested:false,originalCatalogAlgorithm:true,productionProviderBindingVerified:false,transaction:state.transaction,aRoute:state.aRoute,holdDrift:state.holdDrift,candidateValidation:false,checkoutRevision:cfg.checkoutRevision,productionAccepted:false,cloudCalls:0}:undefined;
const result={kind:'isolated-pg-phase-receipt-v1',scope:'fixture-only',seed,epoch:state.epoch,phase,sequence:state.finished.length,previousPhaseSha256:previous,verified:true,terminal:true,journalRecords:records,expectedFaultScenario:['migration-fault','startup-fault','postclear-fault'].includes(phase),productionAccepted:false,...(summary?{summary}:{})};
await once(path.join(journal,phase+'.result.json'),result);console.log(JSON.stringify(result));
