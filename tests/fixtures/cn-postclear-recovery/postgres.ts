/** Real isolated PostgreSQL data plane; called only by the disposable Linux harness. */
import {mark} from './diagnostic';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {withReheldController} from './driver';
import {captureFixtureCatalog,assertCatalogEquivalent}from'./catalog';
import {recoverFixture,databases,digest,type FixtureBinding,type Snapshot,type Database} from './recovery';
const exec=promisify(execFile),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const root=process.argv[2],scenario=process.argv[3];
if(!/^\/tmp\/wsx-postclear-[a-f0-9]{32}$/.test(root)||!['success','old-epoch','writer-unknown','partial-restore'].includes(scenario))throw Error('FIXED_FIXTURE_SCOPE');
mark('read-config');
const config=JSON.parse(await readFile(root+'/postgres.json','utf8'));
if(!/^\/usr\/lib\/postgresql\/[0-9]+\/bin$/.test(config.binDir)||!Number.isInteger(config.port)||config.port<1025||config.port>65535)throw Error('FIXTURE_TOOLS');
const env={PATH:'/usr/bin:/bin',LANG:'C',PGCONNECT_TIMEOUT:'5'};
const args=(db:string,user='fixture_owner')=>['-h','127.0.0.1','-p',String(config.port),'-U',user,'-d',db];
async function sql(db:string,query:string,user='fixture_owner'){
 if(!['postgres',...databases,...databases.map(x=>'recovered_'+x)].includes(db))throw Error('DATABASE_SCOPE');
 return(await exec(config.binDir+'/psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',...args(db,user),'-c',query],{env,timeout:15000,maxBuffer:1048576})).stdout.trim();
}
async function facts(db:string){
 mark('facts-rows');
 const data=JSON.parse(await sql(db,'SELECT coalesce(json_agg(t ORDER BY id),\'[]\'::json) FROM records t;'));
 const tables=JSON.parse(await sql(db,"SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"));
 if(JSON.stringify(tables)!=='["records"]')throw Error('UNEXPECTED_SCHEMA_TABLE');
 mark('facts-catalog');
 const originalCatalog=await captureFixtureCatalog(config,db);
 const postclear=data.filter((x:any)=>x.id===2);if(postclear.length!==1)throw Error('POSTCLEAR_ROW_MISSING');
 return{catalogSha256:originalCatalog.catalogSha256,dataSha256:digest(data),postclearWriteSha256:digest(postclear)};
}
mark('create-roles');
await sql('postgres','CREATE ROLE app NOLOGIN; CREATE ROLE lane NOLOGIN; CREATE ROLE migration_admin NOLOGIN;');
mark('create-source-databases');
for(const db of databases){await sql('postgres','CREATE DATABASE '+db+';');await sql(db,"CREATE TABLE records(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO records VALUES(1,'before-clear'); GRANT SELECT,INSERT ON records TO lane;");}
let restoreCalls=0,captureCalls=0;const capturedCatalogs=new Map<Database,unknown>();
mark('controller-start');
const output=await withReheldController(root,process.env.CN_POSTCLEAR_PYTHON||'/usr/bin/python3',async()=>{
 mark('postclear-write');
 for(const db of databases)await sql(db,"INSERT INTO records VALUES(2,'after-clear');",'lane');
},async context=>{
 mark('controller-reheld');
 const postclearWrites=Object.fromEntries(await Promise.all(databases.map(async db=>[db,(await facts(db)).postclearWriteSha256]))) as FixtureBinding['postclearWrites'];
 const sourcePeers=Object.fromEntries(databases.map(db=>[db,root+'/socket:'+db])) as FixtureBinding['sourcePeers'];
 const binding:FixtureBinding={kind:'isolated-postclear-recovery-v1',root,oldGeneration:context.oldGeneration,newGeneration:context.newGeneration,sourcePeers,targets:Object.fromEntries(databases.map(db=>[db,'recovered_'+db])) as FixtureBinding['targets'],postclearWrites};
 for(const db of databases){let rejected=false;try{await sql(db,"INSERT INTO records VALUES(3,'must-not-commit');",'lane');}catch{rejected=true;}if(!rejected)throw Error('WRITER_STILL_ACCEPTS');}
 let snapshot:Snapshot;
 const port={assertOwnedLock:async()=>{},observe:async()=>{
  mark('observe-writers');
  const live=Number(await sql('postgres',"SELECT count(*) FROM pg_stat_activity WHERE usename='lane';"));
  const logins=await sql('postgres',"SELECT rolcanlogin FROM pg_roles WHERE rolname='lane';");
  return{identity:context.authority.identity,originalPlanSha256:context.authority.sourcePlanSha256,generation:context.newGeneration,held:logins==='f'&&scenario!=='writer-unknown',writerSessions:live,preparedTransactions:Number(await sql('postgres','SELECT count(*) FROM pg_prepared_xacts;')),sourcePeers};
 },capture:async()=>{
  captureCalls++;const entries={}as Snapshot['databases'];
  for(const db of databases){mark('capture-catalog');const fullSource=await captureFixtureCatalog(config,db);capturedCatalogs.set(db,fullSource.facts);const before=await facts(db);if(before.catalogSha256!==fullSource.catalogSha256)throw Error('SOURCE_CATALOG_CHANGED');mark('dump');const archive=Buffer.from((await exec(config.binDir+'/pg_dump',[...args(db),'-Fc'],{env,timeout:30000,maxBuffer:16*1024*1024,encoding:'buffer'})).stdout);mark('write-archive');await writeFile(root+'/'+db+'.dump',archive,{flag:'wx',mode:0o600});const after=await facts(db);if(digest(before)!==digest(after))throw Error('SOURCE_CHANGED_DURING_CAPTURE');entries[db]={archiveSha256:sha(archive),...after};}
  for(const db of databases){const current=await facts(db);if(current.dataSha256!==entries[db].dataSha256||current.catalogSha256!==entries[db].catalogSha256)throw Error('SOURCE_CHANGED_ACROSS_CAPTURE');}
  snapshot={generation:scenario==='old-epoch'?context.oldGeneration:context.newGeneration,originalPlanSha256:context.authority.sourcePlanSha256,databases:entries};return snapshot;
 },restore:async(db:Database,entry:Snapshot['databases'][Database],target:string)=>{
  mark('restore-archive-identity');restoreCalls++;if(sha(await readFile(root+'/'+db+'.dump'))!==entry.archiveSha256)throw Error('ARCHIVE_DRIFT');
  mark('create-target');await sql('postgres','CREATE DATABASE '+target+';');
  mark('restore');await exec(config.binDir+'/pg_restore',[...args(target),'--exit-on-error','--no-owner',root+'/'+db+'.dump'],{env,timeout:30000,maxBuffer:1048576});
  mark('restore-catalog');assertCatalogEquivalent(capturedCatalogs.get(db),(await captureFixtureCatalog(config,target)).facts);
  if(scenario==='partial-restore'&&db==='workspacex_agent'){if(digest(await facts(target))!==digest({catalogSha256:entry.catalogSha256,dataSha256:entry.dataSha256,postclearWriteSha256:entry.postclearWriteSha256}))throw Error('SECOND_RESTORE_NOT_COMMITTED');throw Error('RESTORE_REPLY_UNKNOWN');}
 },readback:async(db:Database,target:string)=>({archiveSha256:sha(await readFile(root+'/'+db+'.dump')),...await facts(target)})};
 let result:unknown,failure:unknown,error='';try{result=await recoverFixture(context,binding,port);}catch(e){failure=e;error=String(e);}
 if(scenario==='success'&&!result)throw Error('RECOVERY_DID_NOT_COMPLETE',{cause:failure});
 if(scenario==='old-epoch'&&(!error.includes('FRESH_SNAPSHOT')||restoreCalls!==0))throw Error('OLD_EPOCH_NOT_REJECTED');
 if(scenario==='writer-unknown'&&(!error.includes('REHELD_WRITERS')||captureCalls!==0))throw Error('WRITER_UNKNOWN_NOT_REJECTED');
 if(scenario==='partial-restore'&&(!error.includes('RESTORE_REPLY_UNKNOWN')||restoreCalls!==2))throw Error('PARTIAL_NOT_REJECTED');
 if(scenario==='old-epoch'||scenario==='partial-restore'){try{await recoverFixture(context,binding,port);throw Error('REPLAY_ALLOWED');}catch(e){if(!String(e).includes('EEXIST'))throw e;}}
 if(scenario==='partial-restore'&&restoreCalls!==2)throw Error('RESTORE_REDISPATCHED');
 for(const db of databases){if((await facts(db)).postclearWriteSha256!==postclearWrites[db])throw Error('SOURCE_NEW_DATA_LOST');}
 return{catalogImplementation:'original-collectFacts-and-canonical',originalCatalogFactsVerified:true,originalCaptureProtocolExecuted:false,providerBindingVerified:false,scenario,result:result||null,expectedFailure:error!=='' ,captureCalls,restoreCalls,sourceNewWritesPreserved:true,productionAccepted:false};
});
console.log(JSON.stringify(output));
