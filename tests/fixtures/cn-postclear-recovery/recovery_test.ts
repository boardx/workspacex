import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {withReheldController,trackFixtureActor} from './driver';
import {diagnostic} from './diagnostic';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {recoverFixture,databases,type FixtureBinding,type FixturePort,type Snapshot,digest} from './recovery';
const identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'postclear-fixture'};
async function withFixture(body:(f:any)=>Promise<void>){
 const root='/tmp/wsx-postclear-'+randomBytes(16).toString('hex');await mkdir(root,{mode:0o700});
 try{return await withReheldController(root,process.env.CN_POSTCLEAR_PYTHON||'/usr/bin/python3',async()=>{},async context=>{
 const {authority}=context;
 const entries=<T>(f:(db:typeof databases[number])=>T)=>Object.fromEntries(databases.map(db=>[db,f(db)])) as Record<typeof databases[number],T>;
 const binding:FixtureBinding={kind:'isolated-postclear-recovery-v1',root,oldGeneration:context.oldGeneration,newGeneration:context.newGeneration,sourcePeers:entries(db=>root+'/socket:'+db),targets:entries(db=>'recovered_'+db),postclearWrites:entries(db=>digest({db,row:'committed-after-clear'}))};
 const snapshot:Snapshot={generation:binding.newGeneration,originalPlanSha256:authority.sourcePlanSha256,databases:entries(db=>({archiveSha256:digest(db+'archive'),catalogSha256:digest(db+'catalog'),dataSha256:digest(db+'current-data'),postclearWriteSha256:binding.postclearWrites[db]}))};
 const restored:string[]=[];let held=true;
 const port:FixturePort={assertOwnedLock:async()=>{},observe:async()=>({identity:authority.identity,originalPlanSha256:authority.sourcePlanSha256,generation:binding.newGeneration,held,writerSessions:held?0:1,preparedTransactions:0,sourcePeers:binding.sourcePeers}),capture:async()=>structuredClone(snapshot),restore:async db=>{restored.push(db);},readback:async db=>snapshot.databases[db]};
 return await body({context,authority,binding,port,restored,snapshot,setHeld:(v:boolean)=>{held=v;}});
 });}finally{await rm(root,{recursive:true,force:true});}
}
test('isolated continuation binds all three current snapshots and remains held',async()=>{await withFixture(async f=>{const r=await recoverFixture(f.context,f.binding,f.port);assert.equal(r.ready,false);assert.equal(r.writesHeld,true);assert.deepEqual(f.restored,[...databases]);await access(f.binding.root+'/recovered.json');await assert.rejects(recoverFixture(f.context,f.binding,f.port),/EEXIST/);assert.equal(f.restored.length,3);});});
test('old epoch refuses every restore and cannot retry claim',async()=>{await withFixture(async f=>{f.snapshot.generation=f.binding.oldGeneration;await assert.rejects(recoverFixture(f.context,f.binding,f.port),/FRESH_SNAPSHOT/);assert.equal(f.restored.length,0);await assert.rejects(recoverFixture(f.context,f.binding,f.port),/EEXIST/);});});
test('unknown or live writer refuses capture and restore',async()=>{await withFixture(async f=>{f.setHeld(false);f.port.capture=async()=>{throw Error('CAPTURE_MUST_NOT_RUN');};await assert.rejects(recoverFixture(f.context,f.binding,f.port),/REHELD_WRITERS/);assert.equal(f.restored.length,0);});});
test('partial restore cannot publish completion or retry remaining databases',async()=>{await withFixture(async f=>{f.port.restore=async db=>{f.restored.push(db);if(db==='workspacex_agent')throw Error('COMMIT_REPLY_UNKNOWN');};await assert.rejects(recoverFixture(f.context,f.binding,f.port),/COMMIT_REPLY_UNKNOWN/);assert.deepEqual(f.restored,['workspacex','workspacex_agent']);await assert.rejects(access(f.binding.root+'/recovered.json'));await assert.rejects(recoverFixture(f.context,f.binding,f.port),/EEXIST/);assert.equal(f.restored.length,2);});});
test('forged serialized authority cannot enter isolated continuation',async()=>{await withFixture(async f=>{await assert.rejects(recoverFixture({...f.context},f.binding,f.port),/REHELD_CAPABILITY_REQUIRED/);assert.equal(f.restored.length,0);});});

test('actor already exited by signal completes cleanup without waiting for another exit',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const stop=trackFixtureActor(child);
 await once(child,'spawn');const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 assert.equal(child.exitCode,null);assert.equal(child.signalCode,'SIGKILL');await stop();
});
test('actor spawn failure is observed and cleanup completes',async()=>{
 const child=spawn('/nonexistent/wsx-fixture-python',[],{stdio:'ignore'});const stop=trackFixtureActor(child);await stop();
});

test('runtime actor error cannot be reported as successful cleanup',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,exitCode:null,signalCode:null,kill:()=>true});
 const stop=trackFixtureActor(child as unknown as ChildProcess);child.emit('error',Error('KILL_FAILED'));
 await assert.rejects(stop(),/ACTOR_EXIT_UNPROVEN/);
});
test('original operation error survives maintenance catch without retry',async()=>{
 const root='/tmp/wsx-postclear-'+randomBytes(16).toString('hex');await mkdir(root,{mode:0o700});let writes=0;
 try{
  await assert.rejects(withReheldController(root,process.env.CN_POSTCLEAR_PYTHON||'/usr/bin/python3',async()=>{
   writes++;throw Object.assign(Error('secret SQL/password'),{code:'42501'});
  },async()=>{throw Error('MUST_NOT_RECOVER');}),error=>{
   const value=diagnostic(error);assert.equal(value.sqlstate,'42501');assert.equal(value.reason,'ORIGINAL_CATCH_NOT_COMPLETED');assert(!JSON.stringify(value).includes('secret'));return true;
  });assert.equal(writes,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
