/** Real application migration prefix + original durable PG controller fixture.
 * Historical prefix is fault-injection input, NOT the deployed schema.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync}from'node:fs';
import {startupDiagnostic}from'../cn-api-startup/diagnostic';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire}from'node:module';
import {execFile}from'node:child_process';
import {promisify}from'node:util';
import {migrate,migrationFiles,MIGRATIONS_DIR}from'../../../apps/api/src/infrastructure/db/migrator';
import {PgDatabase}from'../../../apps/api/src/infrastructure/db/pg-database';
import {PgIdentityRepository}from'../../../apps/api/src/infrastructure/identity/pg-identity-repository';
import {toOrgId}from'../../../apps/api/src/domain/org-id';
const pg=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('pg');
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
async function backup(){const result=await dockerTool('pg_dump',['-Fc','--no-owner','--no-acl','app_epoch']);assert(result.stdout.length>0&&result.stdout.length<=64*1024*1024);await rawOnce(dump,result.stdout);state.dumpSha256=hash(result.stdout);state.dumpBytes=result.stdout.length;}
async function restore(db:string){assert.equal(state.originalEpochRetired,false,'OLD_EPOCH_RESTORE_FORBIDDEN');assert.match(db,/^app_[a-z_]+$/);const bytes=await fs.readFile(dump);assert.equal(hash(bytes),state.dumpSha256);
 await checkContainer();await query('postgres','CREATE DATABASE '+db);
 // Feed only this exact saved dump via stdin, never dump the mutated source.
 await new Promise<void>((resolve,reject)=>{import('node:child_process').then(({spawn})=>{
  const child=spawn('docker',['exec','-i',cfg.containerId,'timeout','85s','pg_restore','-U','fixture_owner','--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname='+db],{stdio:['pipe','ignore','pipe'],env:{PATH:process.env.PATH!,LANG:'C.UTF-8'}});
  let errors=0;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('RESTORE_TIMEOUT'));},90000);
  child.stderr.on('data',(chunk:Buffer)=>{errors+=chunk.length;if(errors>65536){child.kill('SIGKILL');reject(Error('RESTORE_OUTPUT_LIMIT'));}});
  child.on('error',reject);child.stdin.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('RESTORE_FAILED'));});child.stdin.end(bytes);
 });});
 // --no-acl intentionally needs explicit isolated read grants for actual app role.
 await query(db,'GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_rw');
 await hold(db);assert.deepEqual(await ledger(db),state.originalLedger);assert.deepEqual(await actualRead(db),state.applicationReadback);
 assert.deepEqual(await query(db,'TABLE cn_recovery_canary'),state.canary);assert.equal((await query(db,"SELECT to_regclass('organization_creation_requests') x"))[0].x,null);
 await event('isolated-restore',{database:db,originalDumpSha256:state.dumpSha256,ledgerSha256:hash(JSON.stringify(await ledger(db))),actualRepository:'PgIdentityRepository.findOrganization',holdRetained:true});
}
async function readPhase(p:string){const raw=await fs.readFile(path.join(journal,p+'.result.json'));const v=JSON.parse(raw.toString());assert.equal(v.epoch,state.epoch);assert.equal(v.seed,seed);assert.equal(v.phase,p);assert.equal(v.verified,true);for(const item of v.journalRecords){const bytes=await fs.readFile(path.join(journal,item.name));assert.equal(hash(bytes),item.sha256);assert.equal(bytes.toString('base64'),item.rawBase64);}return{raw,value:v};}
if(mode==='--observe'){process.stdout.write((await readPhase(phase)).raw);process.exit(0);}
assert.equal(phases[state.finished.length],phase);const intent=path.join(journal,phase+'.intent.json');await once(intent,{epoch:state.epoch,phase,seed});const begin=state.events.length;
if(phase==='init'){
 const names=migrationFiles();assert(names.length>=2);state.fullCount=names.length;state.originalCount=names.length-1;state.finalOriginalMigration=names.at(-1);
 // Freeze the known historical last migration; a future changed tail requires review.
 assert.equal(state.finalOriginalMigration,'20261006001000_organization_creation_requests.sql');
 const prefix=path.join(root,'prefix'),candidate=path.join(root,'candidate');await fs.mkdir(prefix);await fs.mkdir(candidate);
 const manifest=[];for(const [i,name]of names.entries()){const raw=await fs.readFile(path.join(MIGRATIONS_DIR,name));manifest.push({name,sha256:hash(raw)});await rawOnce(path.join(candidate,name),raw);if(i<names.length-1)await rawOnce(path.join(prefix,name),raw);}
 await once(path.join(root,'original-migration-manifest.json'),manifest);state.migrationManifestSha256=hash(await fs.readFile(path.join(root,'original-migration-manifest.json')));
 await rawOnce(path.join(candidate,'99999999999999_fixture_fault.sql'),Buffer.from('SELECT 1/0;\n'));
 await query('postgres','CREATE DATABASE app_epoch');const applied=await migrate(dbcfg('app_epoch'),{dir:prefix});assert.equal(applied.applied.length,state.originalCount);assert.equal(applied.skipped.length,0);
 await query('app_epoch',"INSERT INTO organizations(id,name,kind) VALUES('org-app-recovery','Current epoch application fixture','organization')");
 await query('app_epoch',"CREATE TABLE cn_recovery_canary(value text);INSERT INTO cn_recovery_canary VALUES('original-current-epoch');GRANT SELECT,INSERT,UPDATE,DELETE ON cn_recovery_canary TO app_rw");
 state.applicationReadback=await actualRead('app_epoch');assert.equal(state.applicationReadback?.name,'Current epoch application fixture');state.canary=await query('app_epoch','TABLE cn_recovery_canary');await hold('app_epoch');
 state.originalLedger=await ledger('app_epoch');await once(path.join(root,'original-ledger.json'),state.originalLedger);
 await event('original-app-prefix-held',{migrationCount:state.originalCount,fullApplicationMigrationCount:names.length,ledgerSha256:hash(JSON.stringify(state.originalLedger)),historicalPrefixFixture:true,holdRetained:true});
 state.checks.push('original_application_prefix_migrations_and_actual_repository');
}else if(phase==='backup'){await held('app_epoch');await backup();await event('current-epoch-backup',{sha256:state.dumpSha256,bytes:state.dumpBytes,epoch:state.epoch});
}else if(phase==='restore'){await restore('app_preflight_restore');state.checks.push('same_original_backup_preflight_restore_actual_repository');
}else if(phase==='compatibility'){
 const applied=await migrate(dbcfg('app_preflight_restore'));assert.deepEqual(applied.applied,[state.finalOriginalMigration]);await hold('app_preflight_restore');assert.deepEqual(await actualRead('app_preflight_restore'),state.applicationReadback);
 await event('actual-final-migration-success',{applied:applied.applied,fullCount:(await ledger('app_preflight_restore')).length});state.checks.push('actual_original_additive_migration_repository_compatible');
}else if(phase==='migration-fault'){
 await held('app_epoch');await assert.rejects(migrate(dbcfg('app_epoch'),{dir:path.join(root,'candidate')}),/99999999999999_fixture_fault.sql/);
 const after=await ledger('app_epoch');assert.equal(after.length,state.fullCount);assert.equal(after.at(-1).name,state.finalOriginalMigration);assert(!after.some((x:any)=>x.name.startsWith('9999')));await once(path.join(root,'partial-ledger.json'),after);await hold('app_epoch');
 await event('partial-original-migration-failed',{originalCount:state.originalCount,committedCount:after.length,committedOriginalMigration:state.finalOriginalMigration,faultSql:'fixture-only SELECT 1/0',ledgerSha256:hash(JSON.stringify(after)),holdRetained:true});
 await restore('app_partial_recovered');state.checks.push('partial_actual_migration_same_epoch_backup_isolated_recovery');
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
const summary=phase==='finalize'?{verified:true,seed,tests:state.checks,epoch:state.epoch,backupSha256:state.dumpSha256,backupBytes:state.dumpBytes,originalMigrationCount:state.originalCount,fullApplicationMigrationCount:state.fullCount,migrationManifestSha256:state.migrationManifestSha256,actualApplicationMigrator:true,businessLayer:'actual-PgIdentityRepository-readback',actualStartApiTested:false,historicalPrefixFixture:true,candidateValidation:false,checkoutRevision:cfg.checkoutRevision,productionAccepted:false,cloudCalls:0}:undefined;
const result={kind:'isolated-pg-phase-receipt-v1',scope:'fixture-only',seed,epoch:state.epoch,phase,sequence:state.finished.length,previousPhaseSha256:previous,verified:true,terminal:true,journalRecords:records,expectedFaultScenario:['migration-fault','startup-fault','postclear-fault'].includes(phase),productionAccepted:false,...(summary?{summary}:{})};
await once(path.join(journal,phase+'.result.json'),result);console.log(JSON.stringify(result));
