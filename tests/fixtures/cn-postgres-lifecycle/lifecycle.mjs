// Isolated lifecycle coordinator. Real PostgreSQL and the exact application
// migrator; business operations below are synthetic SQL contracts, not six UI journeys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {migrate} from './migrator.ts';
const exec=promisify(execFile),root=path.dirname(process.argv[2]);
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert.equal(cfg.host,root+'/socket');assert.equal(cfg.user,'fixture_owner');
const {binDir,seed=0,...connection}=cfg;
assert(Number.isSafeInteger(seed)&&seed>=0&&seed<=2147483647);
const faultDelayMs=seed%21,label=name=>name+'-seed-'+seed;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const PHASES=['init','backup','restore','compatibility','migration-fault','startup-fault','postclear-fault','finalize'];
const mode=process.argv[3]??'all',requested=mode==='all'?'all':process.argv[4];
assert(mode==='all'||mode==='--phase'||mode==='--observe');assert(requested==='all'||PHASES.includes(requested));
async function readResult(phase){
 const dir=path.join(root,'lifecycle-journal'),raw=await fs.readFile(path.join(dir,phase+'.result.json')),value=JSON.parse(raw);
 const saved=JSON.parse(await fs.readFile(path.join(root,'lifecycle-state.json'),'utf8')),index=PHASES.indexOf(phase);
 assert.equal(value.kind,'isolated-pg-phase-receipt-v1');assert.equal(value.scope,'fixture-only');
 assert.equal(value.phase,phase);assert.equal(value.epoch,saved.epoch);assert.equal(value.seed,seed);assert.equal(saved.seed,seed);
 assert.equal(value.sequence,index+1);assert.equal(value.verified,true);assert.equal(value.terminal,true);
 assert.equal(saved.finished[index],phase);assert.equal(value.productionAccepted,false);
 const previous=index?await readResult(PHASES[index-1]):null;
 assert.equal(value.previousPhaseSha256,previous?hash(previous.raw):null);
 for(const item of value.journalRecords){const bytes=Buffer.from(item.rawBase64,'base64');assert.equal(hash(bytes),item.sha256);assert.equal(hash(await fs.readFile(path.join(dir,item.name))),item.sha256);const event=JSON.parse(bytes);assert.equal(event.epoch,saved.epoch);assert.equal(event.seed,seed);}
 return {raw,value};
}
if(mode==='--observe'){process.stdout.write((await readResult(requested)).raw);process.exit(0);}
const journal=path.join(root,'lifecycle-journal'),statePath=path.join(root,'lifecycle-state.json');
let state;
try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;assert(requested==='all'||requested==='init');state={seed,epoch:crypto.randomUUID(),finished:[],events:[],checks:[],baseline:null,backupSha:null,writersResumed:[]};await fs.mkdir(journal);}
assert.equal(state.seed,seed);
const epoch=state.epoch;let previous=state.events.at(-1)?.sha256??null,number=state.events.length,backupSha=state.backupSha,baseline=state.baseline;
const events=state.events,checks=state.checks,archive=path.join(root,'epoch-original.dump'),good=path.join(root,'additive');

async function event(stage,scenario,observed){
 const value={kind:'synthetic-pg-lifecycle-event-v1',seed,faultDelayMs,epoch,sourceDatabase:'epoch_source',backupSha256:backupSha,
   sequence:++number,previousSha256:previous,stage,scenario,observed};
 const raw=Buffer.from(JSON.stringify(value)+'\n'),name=String(number).padStart(3,'0')+'-'+stage+'.json';
 const fd=await fs.open(path.join(journal,name),'wx',0o600);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
 previous=hash(raw);events.push({name,sha256:previous});return previous;
}
async function query(db,sql,params=[],writer=false){
 const c=new pg.Client({...connection,database:db,user:writer?'fixture_writer':connection.user});await c.connect();
 try{return (await c.query(sql,params)).rows;}finally{await c.end();}
}
const rows=db=>query(db,'SELECT id,title FROM documents ORDER BY id');
async function hold(db){
 await query(db,'REVOKE INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public FROM fixture_writer');
 await query(db,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND usename='fixture_writer'",[db]);
 assert.equal((await query(db,"SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND usename='fixture_writer'",[db]))[0].n,0);
 await assert.rejects(query(db,"INSERT INTO documents(id,title) VALUES(900,'blocked')",[],true),e=>e.code==='42501');
}
async function release(db){await query(db,'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fixture_writer');if(!state.writersResumed.includes(db))state.writersResumed.push(db);}
async function pgtool(tool,args){
 return exec(path.join(binDir,tool),['-h',cfg.host,'-U',cfg.user,...args],{timeout:30000,maxBuffer:4*1024*1024,env:{PATH:binDir+':/usr/bin:/bin',HOME:root,LANG:'C.UTF-8'}});
}
async function restore(db){
 assert.match(db,/^[a-z_]+$/);assert.equal(hash(await fs.readFile(archive)),backupSha);
 await query('postgres','CREATE DATABASE '+db);
 await pgtool('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname='+db,archive]);
 await query(db,'GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_writer');
 assert.deepEqual(await rows(db),baseline);
}
async function startupFailure(db){
 const code="const pg=require('pg');(async()=>{const c=new pg.Client(JSON.parse(process.argv[1]));await c.connect();await c.query('SELECT id,title,tag FROM documents');await c.end();await new Promise(r=>setTimeout(r,"+faultDelayMs+"));process.exit(17)})().catch(()=>process.exit(18));";
 try{await exec(process.execPath,['-e',code,JSON.stringify({...connection,database:db})],{cwd:root,timeout:10000,env:{PATH:process.env.PATH,HOME:root},maxBuffer:65536});assert.fail('startup unexpectedly succeeded');}
 catch(e){assert.equal(e.code,17);assert.equal(e.killed,false);return {exitCode:17,terminal:true};}
}
async function recoverOriginal(db,scenario){
 await hold(db);await event('writers-held',scenario,{target:db,writers:0});
 assert(!state.writersResumed.includes(db),'post-clear writer epoch requires independent authorization');
 assert.deepEqual(await rows(db),baseline,'new writes forbid unapproved baseline replacement');
 const target='recovered_'+scenario;await restore(target);
 assert.equal((await query(target,"SELECT to_regclass('public._kernel_migrations') AS x"))[0].x,null);
 assert.equal((await query(target,"SELECT count(*)::int n FROM information_schema.columns WHERE table_name='documents' AND column_name='tag'"))[0].n,0);
 assert.deepEqual(await query(target,'SELECT id,title FROM documents ORDER BY id',[],true),baseline);
 await event('original-recovery',scenario,{target,originalArchiveSha256:backupSha,oldBusinessReadback:true,dataRestoredFromBackup:true,newWritesDiscarded:false});
 checks.push(scenario+'_same_backup_independent_target_old_business_readback');
}
async function phase_init(){
await query('postgres',"CREATE ROLE fixture_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE");
await query('postgres','CREATE DATABASE epoch_source');await query('postgres','CREATE DATABASE us_lifecycle_canary');
await query('us_lifecycle_canary',"CREATE TABLE unchanged(value text);INSERT INTO unchanged VALUES('us-private-fixture')");
state.usBefore=await query('us_lifecycle_canary','TABLE unchanged');
await query('epoch_source',"CREATE TABLE documents(id integer PRIMARY KEY,title text NOT NULL)");
await query('epoch_source','INSERT INTO documents VALUES(1,$1)',[label('baseline-original')]);
await release('epoch_source');await query('epoch_source','INSERT INTO documents VALUES(2,$1)',[label('current-epoch-write')],true);
await hold('epoch_source');baseline=await rows('epoch_source');
const sourceClock=(await query('epoch_source',"SELECT txid_current()::text AS txid,pg_current_wal_lsn()::text AS lsn"))[0];
await event('epoch-held','common',{sourceClock,rowsSha256:hash(JSON.stringify(baseline)),writers:0});

}

async function phase_backup(){
await pgtool('pg_dump',['-Fc','--no-owner','--no-acl','-f',archive,'epoch_source']);backupSha=hash(await fs.readFile(archive));
await event('original-backup','common',{archiveSha256:backupSha,bytes:(await fs.stat(archive)).size});

}

async function phase_restore(){
await restore('isolated_rehearsal');await event('independent-restore','common',{target:'isolated_rehearsal',oldRowsMatch:true});

}

async function phase_compatibility(){
await fs.mkdir(good);
await fs.writeFile(path.join(good,'001_additive.sql'),"ALTER TABLE documents ADD COLUMN tag text NOT NULL DEFAULT 'old-compatible';");
const migrated=await migrate({...connection,database:'isolated_rehearsal'},{dir:good});assert.deepEqual(migrated.applied,['001_additive.sql']);
assert.deepEqual(await migrate({...connection,database:'isolated_rehearsal'},{dir:good}),{applied:[],skipped:['001_additive.sql']});
await release('isolated_rehearsal');
await query('isolated_rehearsal',"INSERT INTO documents(id,title) VALUES(3,'old-writer')",[],true);
await query('isolated_rehearsal',"INSERT INTO documents(id,title,tag) VALUES(4,'new-writer','new-tag')",[],true);
assert.equal((await query('isolated_rehearsal','SELECT title FROM documents WHERE id=4',[],true))[0].title,'new-writer');
assert.equal((await query('isolated_rehearsal','SELECT tag FROM documents WHERE id=3',[],true))[0].tag,'old-compatible');
await hold('isolated_rehearsal');
await event('compatibility','common',{actualApplicationMigrator:true,oldWritesNewReads:true,newWritesOldReads:true,isolatedTarget:true});
checks.push('same_epoch_backup_restore_additive_old_new_read_write_compatibility');

}

async function phase_migration_fault(){
await restore('migration_fault');
const bad=path.join(root,'half-migration');await fs.mkdir(bad);
await fs.copyFile(path.join(good,'001_additive.sql'),path.join(bad,'001_additive.sql'));
await fs.writeFile(path.join(bad,'002_failure.sql'),"INSERT INTO documents(id,title) VALUES(9,'must rollback');CREATE TABLE half_written(id integer);SELECT pg_sleep("+(faultDelayMs/1000)+");SELECT 1/0;");
await assert.rejects(migrate({...connection,database:'migration_fault'},{dir:bad}),/migration 002_failure.sql failed/);
assert.deepEqual(await rows('migration_fault'),baseline);
assert.equal((await query('migration_fault',"SELECT to_regclass('public.half_written') AS x"))[0].x,null);
assert.deepEqual((await query('migration_fault','SELECT name FROM _kernel_migrations ORDER BY name')).map(x=>x.name),['001_additive.sql']);
await event('migration-failed','migration',{firstFileCommitted:true,secondFileSchemaRowsAndLedgerRolledBack:true,terminal:true});
await recoverOriginal('migration_fault','migration');

}

async function phase_startup_fault(){
await restore('startup_fault');await migrate({...connection,database:'startup_fault'},{dir:good});
await event('startup-failed','startup',await startupFailure('startup_fault'));await recoverOriginal('startup_fault','startup');

}

async function phase_postclear_fault(){
await restore('postclear_fault');await migrate({...connection,database:'postclear_fault'},{dir:good});
await release('postclear_fault');await event('scoped-writer-resume','postclear',{fixtureAuthorizationOnly:true});
await query('postclear_fault',"INSERT INTO documents(id,title,tag) VALUES(99,'must-preserve-new-write','after-clear')",[],true);
await event('startup-failed','postclear',await startupFailure('postclear_fault'));await hold('postclear_fault');
const after=await rows('postclear_fault');assert(after.some(x=>x.id===99));assert.notDeepEqual(after,baseline);
await assert.rejects(recoverOriginal('postclear_fault','postclear'),/post-clear writer epoch requires independent authorization/);
assert.deepEqual(await rows('postclear_fault'),after);
await assert.rejects(query('postclear_fault',"INSERT INTO documents(id,title) VALUES(901,'still blocked')",[],true),e=>e.code==='42501');
await event('recovery-blocked','postclear',{status:'BLOCKED_POST_CLEAR_WRITES_REQUIRE_INDEPENDENT_AUTHORIZATION',holdRetained:true,newRowsSha256:hash(JSON.stringify(after)),newWritesPreserved:true,restoreExecuted:false});
assert.equal((await query('postgres',"SELECT count(*)::int n FROM pg_database WHERE datname='recovered_postclear'"))[0].n,0);
checks.push('postclear_new_writes_hold_and_block_unapproved_baseline_restore');

}

async function phase_finalize(){
assert.deepEqual(await rows('epoch_source'),baseline);assert.deepEqual(await query('us_lifecycle_canary','TABLE unchanged'),state.usBefore);
assert.equal(hash(await fs.readFile(archive)),backupSha);
let chain=null;const journalRecords=[];for(const record of events){const raw=await fs.readFile(path.join(journal,record.name));assert.equal(hash(raw),record.sha256);const value=JSON.parse(raw);assert.equal(value.previousSha256,chain);assert.equal(value.epoch,epoch);assert.equal(value.sourceDatabase,'epoch_source');journalRecords.push({...record,rawBase64:raw.toString('base64')});chain=record.sha256;}
checks.push('current_epoch_original_archive_source_and_us_canary_unchanged','durable_single_epoch_fixture_journal_hash_chain_verified');
return {kind:'real-postgres-lifecycle-fixture-v1',seed,faultDelayMs,verified:true,tests:checks,epoch,backupSha256:backupSha,journal:events,journalRecords,journalTailSha256:previous,
 actualApplicationMigrator:true,realDatabase:true,businessLayer:'synthetic-old-new-SQL-contracts',fullReleaseDriverTested:false,productionAccepted:false,cloudCalls:0};

}

const handlers={init:phase_init,backup:phase_backup,restore:phase_restore,compatibility:phase_compatibility,
 'migration-fault':phase_migration_fault,'startup-fault':phase_startup_fault,'postclear-fault':phase_postclear_fault,finalize:phase_finalize};
async function writeOnce(file,raw){const f=await fs.open(file,'wx',0o600);try{await f.writeFile(raw);await f.sync();}finally{await f.close();}}
async function runPhase(phase){
 const resultPath=path.join(journal,phase+'.result.json'),intentPath=path.join(journal,phase+'.intent.json');
 try{return (await readResult(phase)).value;}catch(e){if(e.code!=='ENOENT')throw e;}
 try{await fs.access(intentPath);throw Error('PHASE_UNKNOWN_NO_REPLAY');}catch(e){if(e.code!=='ENOENT')throw e;}
 assert.equal(PHASES[state.finished.length],phase,'PHASE_ORDER_REQUIRED');
 let previousPhaseSha256=null;
 if(state.finished.length){const prev=state.finished.at(-1);previousPhaseSha256=hash(await fs.readFile(path.join(journal,prev+'.result.json')));}
 await writeOnce(intentPath,JSON.stringify({seed,epoch,phase,previousPhaseSha256})+'\n');
 let prev=null;for(const item of events){const raw=await fs.readFile(path.join(journal,item.name));assert.equal(hash(raw),item.sha256);const value=JSON.parse(raw);assert.equal(value.previousSha256,prev);assert.equal(value.epoch,epoch);prev=item.sha256;}
 const begin=events.length,final=await handlers[phase]();
 state.finished.push(phase);state.backupSha=backupSha;state.baseline=baseline;
 const temporary=statePath+'.'+phase+'.tmp';await writeOnce(temporary,JSON.stringify(state)+'\n');await fs.rename(temporary,statePath);
 const phaseRecords=[];
 for(const item of events.slice(begin)){const raw=await fs.readFile(path.join(journal,item.name));assert.equal(hash(raw),item.sha256);phaseRecords.push({...item,rawBase64:raw.toString('base64')});}
 const result={kind:'isolated-pg-phase-receipt-v1',scope:'fixture-only',seed,faultDelayMs,epoch,phase,sequence:state.finished.length,previousPhaseSha256,backupSha256:backupSha,
  verified:true,terminal:true,journalRecords:phaseRecords,productionAccepted:false,fullReleaseDriverTested:false,
  expectedFaultScenario:['migration-fault','startup-fault','postclear-fault'].includes(phase),...(final?{summary:final}:{})};
 await writeOnce(resultPath,JSON.stringify(result)+'\n');return result;
}
let result;
if(requested==='all'){for(const phase of PHASES)result=await runPhase(phase);}else result=await runPhase(requested);
console.log(JSON.stringify(requested==='all'?result.summary:result));
