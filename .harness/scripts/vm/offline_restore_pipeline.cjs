'use strict';
// No spawn, credentials, network or executable entrypoint. The sealed host owns
// pinning and starting the offline children; this module owns their complete lifetime.
const {decodeSql}=require('./restore_sql_stream.cjs');
const {restoreExistingSession}=require('./existing_session_restore.cjs');
function proof(ok,code){if(!ok)throw Error(code);}
function trackChildren(children){
 return children.map(child=>{
  const state={child,closed:false,success:false,valid:!!child&&typeof child.once==='function'&&typeof child.kill==='function'};
  state.closedPromise=state.valid?new Promise(resolve=>child.once('close',(code,signal)=>{state.closed=true;state.success=code===0&&signal===null;resolve();})):Promise.resolve();
  return state;
 });
}
async function abortTracked(states,killGraceMs){
 for(const {child} of states){for(const stream of [child?.stdout,child?.stdin,child?.stderr]){try{stream?.destroy();}catch{}}}
 for(const state of states)if(state.valid&&!state.closed){try{state.child.kill('SIGTERM');}catch{}}
 async function joinedWithin(ms){let timeout;try{return await Promise.race([Promise.all(states.map(s=>s.closedPromise)).then(()=>states.every(s=>s.valid&&s.closed)),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timeout);}}
 let joined=await joinedWithin(killGraceMs);
 if(!joined){for(const state of states)if(state.valid&&!state.closed){try{state.child.kill('SIGKILL');}catch{}}joined=await joinedWithin(killGraceMs);}
 proof(joined,'OFFLINE_PIPELINE_CLEANUP_UNKNOWN');return {joined:true,holdMustRemain:true};
}
function superviseOfflinePipeline({decrypt,decoder,deadlineMs,killGraceMs=2000,expectedInputBytes},ownership){
 proof(Number.isSafeInteger(deadlineMs)&&deadlineMs>=100&&deadlineMs<=1800000&&Number.isSafeInteger(killGraceMs)&&killGraceMs>=10&&killGraceMs<=10000,'OFFLINE_PIPELINE_DEADLINE');
 proof(expectedInputBytes===undefined||(Number.isSafeInteger(expectedInputBytes)&&expectedInputBytes>0&&expectedInputBytes<=16*1024**3),'OFFLINE_PIPELINE_INPUT_BOUND');
 const children=[decrypt,decoder];
 proof(children.every(c=>c&&c.exitCode===null&&c.signalCode===null&&typeof c.kill==='function'&&typeof c.on==='function')&&decrypt.stdout?.pipe&&decoder.stdin?.write&&decoder.stdout?.[Symbol.asyncIterator],'OFFLINE_PIPELINE_CHILDREN');
 let failed=false,inputEof=false,inputFinished=false,outputEof=false,completed=false,cleanupPromise,inputBytes=0;
 let rejectFailure;const failure=new Promise((_,reject)=>{rejectFailure=reject;});failure.catch(()=>{});
 function fail(){if(!failed){failed=true;rejectFailure(Error('OFFLINE_PIPELINE_REJECTED'));}}
 const states=ownership||trackChildren(children);
 for(const child of children){child.on('error',fail);child.once('close',(code,signal)=>{if(code!==0||signal!==null)fail();});child.stderr?.on('error',fail);child.stderr?.resume();}
 decrypt.stdout.once('end',()=>{inputEof=true;});
 decrypt.stdout.on('data',chunk=>{inputBytes+=chunk.length;if(expectedInputBytes!==undefined&&inputBytes>expectedInputBytes)fail();});
 decoder.stdin.once('finish',()=>{inputFinished=true;});
 for(const stream of [decrypt.stdout,decoder.stdin,decoder.stdout])stream.on('error',fail);
 const timer=setTimeout(fail,deadlineMs);
 try{decrypt.stdout.pipe(decoder.stdin);}catch{clearTimeout(timer);throw Error('OFFLINE_PIPELINE_SETUP_REJECTED');}
 async function* output(){
  const iterator=decoder.stdout[Symbol.asyncIterator]();
  while(true){const item=await Promise.race([iterator.next(),failure]);if(item.done){outputEof=true;return;}proof(Buffer.isBuffer(item.value)&&item.value.length<=65536,'OFFLINE_PIPELINE_OUTPUT_BOUND');yield item.value;}
 }
 async function verifyCompletion(){
  proof(outputEof&&!failed,'OFFLINE_PIPELINE_EOF_REQUIRED');
  await Promise.race([Promise.all(states.map(s=>s.closedPromise)),failure]);
  proof(inputEof&&inputFinished&&states.every(s=>s.closed&&s.success)&&!failed&&(expectedInputBytes===undefined||inputBytes===expectedInputBytes),'OFFLINE_PIPELINE_COMPLETE_REQUIRED');
  completed=true;clearTimeout(timer);
  return {fullInputEof:true,fullOutputEof:true,joined:true,decryptExitCode:0,decoderExitCode:0};
 }
 function abortAndJoin(){
  if(cleanupPromise)return cleanupPromise;
  cleanupPromise=(async()=>{
   clearTimeout(timer);fail();decrypt.stdout.unpipe(decoder.stdin);
   return abortTracked(states,killGraceMs);
  })();return cleanupPromise;
 }
 return {operations:decodeSql(output()),rawOutput:output,verifyCompletion,abortAndJoin,isCompleted:()=>completed};
}
async function restoreFromOfflinePipeline(options,pipelineSpec){
 // Take lifetime ownership before any validation or synchronous pipe setup.
 const ownership=trackChildren([pipelineSpec?.decrypt,pipelineSpec?.decoder]);let pipeline;
 try{
  pipeline=superviseOfflinePipeline(pipelineSpec,ownership);
  const abort=async()=>{try{await pipeline.abortAndJoin();}finally{await pipelineSpec.afterAbort?.();}};
  return await restoreExistingSession({...options,operations:pipeline.operations,verifyDecoderCompletion:async evidence=>{const completion=await pipeline.verifyCompletion();await options.verifyDecoderCompletion({...evidence,...completion});},abortDecoder:abort});
 }catch(error){
  // Includes failures before BEGIN/identity verification; those still own the children.
  let cleanupConfirmed=false;try{try{if(pipeline)await pipeline.abortAndJoin();else await abortTracked(ownership,Number.isSafeInteger(pipelineSpec?.killGraceMs)&&pipelineSpec.killGraceMs>=10&&pipelineSpec.killGraceMs<=10000?pipelineSpec.killGraceMs:2000);}finally{await pipelineSpec?.afterAbort?.();}cleanupConfirmed=true;}catch{}
  const failure=Error('OFFLINE_RESTORE_FAILED');failure.recovery={...(error.recovery||{}),decoderCleanupConfirmed:cleanupConfirmed,holdMustRemain:true};throw failure;
 }
}
module.exports={superviseOfflinePipeline,restoreFromOfflinePipeline};
