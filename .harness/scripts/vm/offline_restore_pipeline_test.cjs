'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {superviseOfflinePipeline,restoreFromOfflinePipeline}=require('./offline_restore_pipeline.cjs');
function child(ignoreTerm=false,neverClose=false){
 const c=new EventEmitter();c.stdout=new PassThrough();c.stdin=new PassThrough();c.exitCode=null;c.signalCode=null;c.kills=[];
 c.finish=(code=0,signal=null)=>{if(c.exitCode!==null||c.signalCode!==null)return;c.exitCode=code;c.signalCode=signal;c.emit('close',code,signal);};
 c.kill=signal=>{c.kills.push(signal);if(!neverClose&&(!ignoreTerm||signal==='SIGKILL'))queueMicrotask(()=>c.finish(null,signal));return true;};return c;
}
function pair(){const decrypt=child(),decoder=child();decoder.stdin.resume();return {decrypt,decoder,deadlineMs:100,killGraceMs:10};}
async function consume(pipeline){let count=0;for await(const op of pipeline.operations){assert.equal(op.kind,'sql');count++;}return count;}
(async()=>{let count=0;
 const ok=pair();const p=superviseOfflinePipeline(ok);ok.decrypt.stdout.end(Buffer.from('archive'));ok.decoder.stdout.end(Buffer.from('CREATE TABLE t (id int);\n'));setImmediate(()=>{ok.decrypt.finish();ok.decoder.finish();});assert.equal(await consume(p),1);assert.equal((await p.verifyCompletion()).joined,true);count++;
 for(const stage of ['decrypt','decoder']){const f=pair(),p=superviseOfflinePipeline(f);f.decrypt.stdout.end(Buffer.from('archive'));f.decoder.stdout.end(Buffer.from('CREATE TABLE t (id int);\n'));setImmediate(()=>{f.decrypt.finish(stage==='decrypt'?1:0);f.decoder.finish(stage==='decoder'?1:0);});await consume(p);await assert.rejects(p.verifyCompletion(),/OFFLINE_PIPELINE/);await p.abortAndJoin();count++;}
 const missing=pair(),mp=superviseOfflinePipeline(missing);missing.decoder.stdout.end(Buffer.from('CREATE TABLE t (id int);\n'));setImmediate(()=>{missing.decrypt.finish();missing.decoder.finish();});await consume(mp);await assert.rejects(mp.verifyCompletion(),/COMPLETE_REQUIRED/);await mp.abortAndJoin();count++;
 const stalled=pair(),sp=superviseOfflinePipeline(stalled);await assert.rejects(consume(sp),/REJECTED/);assert.equal((await sp.abortAndJoin()).joined,true);assert.deepEqual(stalled.decrypt.kills,['SIGTERM']);count++;
 const kill=pair();kill.decrypt=child(true);const kp=superviseOfflinePipeline(kill);await kp.abortAndJoin();assert.deepEqual(kill.decrypt.kills,['SIGTERM','SIGKILL']);count++;
 const unknown=pair();unknown.decoder=child(false,true);const up=superviseOfflinePipeline(unknown);await assert.rejects(up.abortAndJoin(),/CLEANUP_UNKNOWN/);count++;
 for(const fault of ['deadline','pipe']){const f=pair();if(fault==='deadline')f.deadlineMs=0;else f.decrypt.stdout.pipe=()=>{throw Error('synchronous pipe rejected');};await assert.rejects(restoreFromOfflinePipeline({},f),e=>e.recovery.decoderCleanupConfirmed&&e.recovery.holdMustRemain);assert.deepEqual(f.decrypt.kills,['SIGTERM']);assert.deepEqual(f.decoder.kills,['SIGTERM']);count++;}
 for(const failureStage of ['identity','verify','cleanup']){
  const f=pair();if(failureStage==='cleanup')f.decoder=child(false,true);let status='I';const order=[];const binding={pid:41};
  const client={query:async sql=>{order.push(sql);if(sql.startsWith('BEGIN'))status='T';if(sql==='ROLLBACK')status='I';return {rows:[]};}};
  const oldKill=f.decrypt.kill;f.decrypt.kill=signal=>{order.push('decoder-stop');return oldKill(signal);};
  const options={client,Query:function(){},binding,identity:async()=>failureStage==='identity'?{pid:42}:binding,transactionStatus:()=>status,maxCopyBytes:1024,verifyOperation:async()=>{},verifyDecoderCompletion:async()=>{},verifyWithinTransaction:async()=>{throw Error('verification rejected');}};
  if(failureStage!=='identity'){f.decrypt.stdout.end(Buffer.from('archive'));f.decoder.stdout.end(Buffer.from('CREATE TABLE t (id int);\n'));setImmediate(()=>{f.decrypt.finish();if(failureStage!=='cleanup')f.decoder.finish();});}
  await assert.rejects(restoreFromOfflinePipeline(options,f),e=>e.message==='OFFLINE_RESTORE_FAILED'&&e.recovery.holdMustRemain&&e.recovery.decoderCleanupConfirmed===(failureStage!=='cleanup'));
  assert(!order.includes('COMMIT'));if(failureStage==='identity')assert(!order.includes('ROLLBACK'));count++;
 }
 console.log(`${count} offline decoder lifetime assertions PASS; synthetic children only; no process/DB/container started`);
})().catch(e=>{console.error(e);process.exitCode=1;});
