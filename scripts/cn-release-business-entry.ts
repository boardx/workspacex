/** Bundled fixed child: state and secrets only through its privileged parent. */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { executeBusiness, validateLiveState } from './cn-release-business-runner';
const require=createRequire(import.meta.url);
let initialized=false,resolveState:((x:any)=>void)|undefined;
const send=(x:unknown)=>process.stdout.write(JSON.stringify(x)+'\n');
const requestState=()=>new Promise<any>(resolve=>{if(resolveState)throw Error('STATE_PENDING');resolveState=resolve;send({type:'read-state'});});
const lines=createInterface({input:process.stdin});
async function readback(value:any){
 const {execution,receipt,token}=value;
 if(typeof token!=='string'||Buffer.byteLength(token)>16384)throw Error('SESSION_BOUND');
 const window=execution.mode==='rollback'?execution.rollbackApproval:{issuedAt:execution.identity.requestedAt,expiresAt:execution.identity.deadlineAt};
 const observed=Date.parse(receipt.observedAt);if(!Number.isFinite(observed)||observed<Date.parse(window.issuedAt)||observed>Date.parse(window.expiresAt)||observed>Date.now())throw Error('EXECUTION_WINDOW');
 const state=await requestState();validateLiveState(execution,state,Date.now(),observed);
 if(state.runtimeInventorySha256!==receipt.runtimeInventorySha256)throw Error('ACCEPTED_INVENTORY_CHANGED');
 if(receipt.kind!=='cn-independent-business-acceptance-v1'||receipt.externalWritesTerminal!==false||!Array.isArray(receipt.ownedAcceptanceRunIds)||receipt.ownedAcceptanceRunIds.length!==3||new Set(receipt.ownedAcceptanceRunIds).size!==3)throw Error('RECEIPT');
 for(const id of receipt.ownedAcceptanceRunIds){
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('RUN_ID');
  const response=await fetch(new URL('/api/agent-runs/'+id,execution.publicOrigin),{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('READBACK');const reader=response.body!.getReader();let raw='',bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();throw Error('READ_BOUND');}raw+=new TextDecoder().decode(value);}
  const run=JSON.parse(raw);if(run.status!=='succeeded'||typeof run.resultMessageId!=='string')throw Error('RUN_TERMINAL');
 }
 const after=await requestState();validateLiveState(execution,after,Date.now(),observed);
 if(after.runtimeInventorySha256!==receipt.runtimeInventorySha256||state.clearReceiptSha256!==after.clearReceiptSha256||state.writerResumeApprovalSha256!==after.writerResumeApprovalSha256)throw Error('STATE_CHANGED');
 return {kind:'cn-business-terminal-observation-v1',releaseSha256:execution.releaseSha256,identity:execution.identity,
  businessReceiptSha256:createHash('sha256').update(value.receiptRaw).digest('hex'),clearReceiptSha256:after.clearReceiptSha256,
  writerResumeApprovalSha256:after.writerResumeApprovalSha256,observedAt:new Date().toISOString(),externalWritesTerminal:true,ownedRunCount:3};
}
lines.on('line',line=>{
 if(Buffer.byteLength(line)>65536){process.exitCode=2;lines.close();return;}
 try{
  const value=JSON.parse(line);
  if(!initialized){
   initialized=true;
   const operation=value.operation==='readback'?readback(value):executeBusiness(value.execution,{chromium:require(value.execution.plan.playwrightModule).chromium,
    readLiveState:requestState,captureSession:async token=>{send({type:'private-session',token});}});
   operation.then(receipt=>{send({type:'result',receipt});lines.close();})
    .catch(()=>{send({type:'failed',reason:'BUSINESS_UNKNOWN_RECONCILE_REQUIRED'});process.exitCode=2;lines.close();});
  }else{if(!resolveState)throw Error('UNEXPECTED_INPUT');const resolve=resolveState;resolveState=undefined;resolve(value);}
 }catch{send({type:'failed',reason:'BUSINESS_UNKNOWN_RECONCILE_REQUIRED'});process.exitCode=2;lines.close();}
});
