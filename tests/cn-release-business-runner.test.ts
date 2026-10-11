import {execFileSync} from 'node:child_process';
/** Offline execution of the real canonical UI runner against a fake browser.
 * No network, credentials, provider claim or production PASS is produced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { executeBusiness, validateLiveState, type Execution, type LiveState } from '../scripts/cn-release-business-runner';
const require=createRequire(import.meta.url),fs=require('node:fs');
const audio=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(44)]), audioPath='/etc/workspacex-cn/maintenance-activation/offline.wav';
const original=fs.readFileSync;
fs.readFileSync=function(p:unknown,...args:unknown[]){return p===audioPath?audio:original.call(this,p,...args);};
const start=Date.parse('2026-10-11T20:00:00Z');
function fixture(){
 const identity={sourceRevision:'a'.repeat(40),baselineRevision:'b'.repeat(40),controlRevision:'c'.repeat(40),publicationAttemptId:'published',attemptId:'release',requestedAt:new Date(start).toISOString(),deadlineAt:new Date(start+1800000).toISOString()};
 const r:Execution={mode:'acceptance',identity,releaseSha256:'4'.repeat(64),publicOrigin:'https://app.boardx.com.cn/',bindingSha256:'d'.repeat(64),switchReceiptSha256:'e'.repeat(64),holdGeneration:'7'.repeat(32),stableWindowSeconds:0,plan:{publicUrl:'https://app.boardx.com.cn/',email:'isolated@example.invalid',password:'offline-only',agentId:'agent',threadId:'thread',feedbackId:'feedback',githubIssueNumber:1,skillVersionId:'skill',skillSentinel:'sentinel',skillPrompt:'skill',pdfPrompt:'pdf',audioPath,audioSha256:createHash('sha256').update(audio).digest('hex'),expectedTranscript:'spoken fixture',browserExecutable:'/usr/bin/chromium',playwrightModule:'/opt/workspacex-cn/release-tools/fixture',deploymentMarker:'fixture-marker'}};
 const state:LiveState={identity,boundary:{phase:'production-public',lockRetained:true,writesHeld:false,testDataScopeApproved:true,publicResumeAuthorized:true},runtimeRevision:identity.sourceRevision,runtimeInventorySha256:'9'.repeat(64),deploymentMarker:'fixture-marker',bindingSha256:r.bindingSha256,switchReceiptSha256:r.switchReceiptSha256,holdGeneration:'7'.repeat(32),observedAt:new Date(start).toISOString(),clearReceiptSha256:'f'.repeat(64),runtimeHealthy:true,writerResumeApprovalSha256:'2'.repeat(64),testDataScopeSha256:'3'.repeat(64)};
 const a={kind:'cn-writer-resume-approval-v1',identity,releaseSha256:'4'.repeat(64),target:{accountId:'1177216024653153',region:'cn-shanghai',ecsInstanceId:'i-uf6ga92ewloganobbln6'},heldHealthSha256:'5'.repeat(64),holdRawSha256:'6'.repeat(64),userAuthorizationEvidenceSha256:'7'.repeat(64),bindingSha256:r.bindingSha256,switchReceiptSha256:r.switchReceiptSha256,holdGeneration:'7'.repeat(32),testDataScopeSha256:state.testDataScopeSha256,issuedAt:identity.requestedAt,expiresAt:identity.deadlineAt,publicOrigin:'https://app.boardx.com.cn/',scope:'a5-resume-writers-and-a6-scoped-business-observation'};
 const raw=JSON.stringify(a);r.writerResumeApproval={raw,approvalSha256:createHash('sha256').update(raw).digest('hex')};state.writerResumeApprovalSha256=r.writerResumeApproval.approvalSha256;
 return {r,state};
}
function fakeBrowser(failPdf=false,afterRun:()=>void=()=>{}){
 let launched=0,closed=0,runs=0;
 const locator:any={fill:async()=>{},click:async()=>{},last(){return this},first(){return this},filter(){return this},getByTestId(){return this},waitFor:async()=>{},innerText:async()=> 'actual fake sentinel',inputValue:async()=> 'spoken fixture',count:async()=>0,getAttribute:async(k:string)=>k==='href'?'/fixture.pdf':k==='aria-expanded'?'true':'false'};
 const page:any={setDefaultTimeout(){},goto:async()=>{},getByTestId:()=>locator,locator:()=>locator,waitForFunction:async()=>{},waitForURL:async()=>{},waitForResponse:async()=>({status:()=>200,text:async()=>{runs++;afterRun();return `data: {"type":"CUSTOM","name":"execution_event","value":{"runId":"run${runs}"}}\ndata: {"type":"RUN_FINISHED"}`;}}),evaluate:async(_fn:unknown,arg:string)=>{
  if(arg===undefined)return [{deploymentMarker:'fixture-marker'},{deploymentMarker:'fixture-marker',trustworthy:true}];
  if(arg.startsWith('/api/feedback/'))return {feedbackId:'feedback',number:1,state:'open'};
  if(arg.startsWith('/api/agent-runs/'))return {status:'succeeded',resultMessageId:'message',skillVersionIds:['skill']};
  if(arg==='/fixture.pdf')return failPdf?'HTML!':'%PDF-';throw Error('UNEXPECTED_FAKE_CALL');
 }};
 return {chromium:{launch:async()=>{launched++;return {newContext:async()=>({newPage:async()=>page,close:async()=>{closed++;}}),close:async()=>{closed++;}}}},stats:()=>({launched,closed,runs})};
}
test('real canonical six UI paths produce strict receipt only after persisted runs and PDF',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();const result=await executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start,monotonic:()=>0});
 assert.equal(result.kind,'cn-independent-business-acceptance-v1');assert.equal(Object.keys(result.checks).length,6);assert.equal(result.externalWritesTerminal,false);assert.deepEqual(b.stats(),{launched:1,closed:2,runs:3});
});
test('held acceptance blocks before browser launch; no flag waives canonical boundary',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();state.boundary.phase='production-held-readback';state.boundary.writesHeld=true;
 await assert.rejects(executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start}),/HELD_WRITE_JOURNEY_FORBIDDEN/);assert.equal(b.stats().launched,0);
});
test('isolated receipt cannot masquerade as production acceptance',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();state.boundary.phase='isolated-candidate';state.boundary.publicResumeAuthorized=false;state.clearReceiptSha256=null;state.writerResumeApprovalSha256=null;delete r.writerResumeApproval;r.publicOrigin='https://isolated.example.invalid/';r.plan.publicUrl=r.publicOrigin;
 const result=await executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start,monotonic:()=>0});assert.equal(result.kind,'cn-isolated-business-acceptance-v1');
});
test('PDF failure emits no receipt and closes browser',async()=>{
 const {r,state}=fixture(),b=fakeBrowser(true);await assert.rejects(executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start}),/PDF_MAGIC/);assert.equal(b.stats().closed,2);
});
test('runtime or scope/clear mismatch rejects before side effects',()=>{
 for(const mutate of [(s:LiveState)=>{s.runtimeRevision='b'.repeat(40)},(s:LiveState)=>{s.boundary.testDataScopeApproved=false},(s:LiveState)=>{s.clearReceiptSha256=null},(s:LiveState)=>{s.holdGeneration='8'.repeat(32)}]){
  const {r,state}=fixture();mutate(state);assert.throws(()=>validateLiveState(r,state,start));
 }
});
test('rollback validates old runtime and retains original expired clock with fresh approval',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();r.mode='rollback';state.runtimeRevision=r.identity.baselineRevision;
 r.rollbackApproval={baselineRevision:r.identity.baselineRevision,issuedAt:new Date(start+2000000).toISOString(),expiresAt:new Date(start+2100000).toISOString(),approvalSha256:'1'.repeat(64)};state.observedAt=r.rollbackApproval.issuedAt;const a=JSON.parse(r.writerResumeApproval!.raw);a.kind='cn-recovery-writer-resume-approval-v1';a.scope='resume-baseline-writers-and-scoped-business-observation';a.runtimeRecoveryReceiptSha256=a.switchReceiptSha256;delete a.switchReceiptSha256;a.recoveryApprovalSha256=r.rollbackApproval.approvalSha256;a.issuedAt=r.rollbackApproval.issuedAt;a.expiresAt=r.rollbackApproval.expiresAt;r.writerResumeApproval!.raw=JSON.stringify(a);r.writerResumeApproval!.approvalSha256=createHash('sha256').update(r.writerResumeApproval!.raw).digest('hex');state.writerResumeApprovalSha256=r.writerResumeApproval!.approvalSha256;
 const result=await executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start+2000000,monotonic:()=>0});assert.equal(result.runtimeRevision,r.identity.baselineRevision);assert.equal(result.deadlineAt,r.identity.deadlineAt);
});
test('state changes during browser cannot produce receipt',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();let reads=0;await assert.rejects(executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>({...state,clearReceiptSha256:++reads===1?'f'.repeat(64):'0'.repeat(64)}),now:()=>start}),/LIVE_STATE_CHANGED/);
});
test('original deadline expiry after UI remains failure',async()=>{
 const {r,state}=fixture();let elapsed=0;const b=fakeBrowser(false,()=>{elapsed=1800000;});await assert.rejects(executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start+elapsed}),/BUSINESS_DEADLINE/);assert.equal(b.stats().runs,3);assert.equal(b.stats().closed,2);
});
test('observe proves a real monotonic window with repeated fresh state',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();r.mode='observe';r.stableWindowSeconds=30;let elapsed=0;
 const result=await executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>({...state,observedAt:new Date(start+elapsed).toISOString()}),now:()=>start+elapsed,monotonic:()=>elapsed,wait:async(ms)=>{elapsed+=ms;}});assert.equal(elapsed,30000);assert.equal(result.liveObservationSha256.length,7);
});

test('A5 is separate and clear must actually link its exact scoped approval',()=>{
 for(const mutate of [(r:Execution,s:LiveState)=>{delete r.writerResumeApproval},(r:Execution,s:LiveState)=>{s.writerResumeApprovalSha256='0'.repeat(64)},(r:Execution,s:LiveState)=>{s.testDataScopeSha256='0'.repeat(64)},(r:Execution,s:LiveState)=>{r.writerResumeApproval!.raw='{}'}]){
  const {r,state}=fixture();mutate(r,state);assert.throws(()=>validateLiveState(r,state,start),/A5_/);
 }
});

test('approval reordered target keys accepted, duplicate JSON rejected',()=>{
 const {r,state}=fixture();const a=JSON.parse(r.writerResumeApproval!.raw);a.target={accountId:a.target.accountId,ecsInstanceId:a.target.ecsInstanceId,region:a.target.region};
 r.writerResumeApproval!.raw=JSON.stringify(a)+'\n';r.writerResumeApproval!.approvalSha256=createHash('sha256').update(r.writerResumeApproval!.raw).digest('hex');state.writerResumeApprovalSha256=r.writerResumeApproval!.approvalSha256;validateLiveState(r,state,start);
 r.writerResumeApproval!.raw=r.writerResumeApproval!.raw.replace('{','{"kind":"fake",');r.writerResumeApproval!.approvalSha256=createHash('sha256').update(r.writerResumeApproval!.raw).digest('hex');state.writerResumeApprovalSha256=r.writerResumeApproval!.approvalSha256;assert.throws(()=>validateLiveState(r,state,start),/A5_CANONICAL_RAW/);
});

test('accepted receipt pins actual runtime inventory and stable-window replacement rejects',async()=>{
 const {r,state}=fixture(),b=fakeBrowser();const result=await executeBusiness(r,{chromium:b.chromium,readLiveState:async()=>state,now:()=>start,monotonic:()=>0});assert.equal(result.runtimeInventorySha256,state.runtimeInventorySha256);
 let reads=0;await assert.rejects(executeBusiness(r,{chromium:fakeBrowser().chromium,readLiveState:async()=>({...state,runtimeInventorySha256:++reads===1?'9'.repeat(64):'8'.repeat(64)}),now:()=>start,monotonic:()=>0}),/LIVE_STATE_CHANGED/);
});

test('Python ISO UTC microseconds survive exact identity and raw A5 consumption',()=>{
 const {r,state}=fixture();const pythonTime=(v:string)=>execFileSync('python3',['-c',"import datetime,sys;print(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).isoformat(timespec='microseconds'))",v],{encoding:'utf8'}).trim();
 r.identity={...r.identity,requestedAt:pythonTime(r.identity.requestedAt),deadlineAt:pythonTime(r.identity.deadlineAt)};state.identity={...r.identity};state.observedAt=pythonTime(state.observedAt);
 const a=JSON.parse(r.writerResumeApproval!.raw);a.identity={...r.identity};a.issuedAt=pythonTime(a.issuedAt);a.expiresAt=pythonTime(a.expiresAt);
 r.writerResumeApproval!.raw=JSON.stringify(a)+'\n';r.writerResumeApproval!.approvalSha256=createHash('sha256').update(r.writerResumeApproval!.raw).digest('hex');state.writerResumeApprovalSha256=r.writerResumeApproval!.approvalSha256;
 validateLiveState(r,state,start);assert.ok(r.identity.requestedAt.endsWith('+00:00'));
});
