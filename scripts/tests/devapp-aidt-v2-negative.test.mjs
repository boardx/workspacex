/** Pure QA-control tests. Fake locators test control flow; these are not browser/model acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2VoicePlan } from '../../apps/web/e2e/support/devapp-aidt-v2-plan.mjs';
import { createV2ExecutionLedger } from '../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';
import { beginV2Case, assertV2CaseReceipt, v2CaseHash } from '../../apps/web/e2e/support/devapp-aidt-v2-cases.mjs';
import { V2_CANDIDATE_CANCEL_PATHS, assertV2CancelRun, runV2CandidateCancellation } from '../../apps/web/e2e/support/devapp-aidt-v2-negative-candidates.mjs';
import { V2_CREATE_CANCEL_KINDS } from '../../apps/web/e2e/support/devapp-aidt-v2-negative-dialogs.mjs';
const scope={source:'a'.repeat(40),controlSource:'b'.repeat(40),tag:'123-1',run:'456',attempt:'1',orgId:'qa-org',actorId:'qa-user',orgRole:'consultant',projectId:'prj-11111111-1111-4111-8111-111111111111'};
const stage={projectId:scope.projectId,stageId:1,revision:7,content:{draft:{fields:{originalTheme:'学生原命题',rewrittenTheme:'原改写',sibling:'兄弟实体原文'}}}};
function fixture(caseId='CRUD-02') {
  const plan=createV2VoicePlan(),ledger=createV2ExecutionLedger(plan,scope),shots=[];
  const ui={stage:async()=>structuredClone(stage)};
  const capture=async filename=>{const result={filename:filename+'.png',sha256:v2CaseHash(filename),bytes:1024};shots.push(result);return result;};
  return {plan,ledger,ui,capture,shots,runtimeScope:()=>scope,caseId,stageId:1};
}
test('five cancellation runs are exact one-use teaching slots bound to 05, never reuse positive 04',()=>{
  const p=createV2VoicePlan();
  assert.equal(Object.keys(V2_CANDIDATE_CANCEL_PATHS).length,5);
  for(const [s,c] of Object.entries(V2_CANDIDATE_CANCEL_PATHS)){
    const row=p.operations.find(x=>x.id===c.operationId);assert.equal(row.kind,'teaching');assert.deepEqual(row.caseIds,[`AI-S${s}-05`]);
    assert.equal(p.caseBindings.find(x=>x.caseId===`AI-S${s}-05`).requiresModel,true);
    assert.equal(p.caseBindings.find(x=>x.caseId===`AI-S${s}-04`).operationIds.includes(c.operationId),false);
  }
});
test('readonly negative and keyboard cases do not require unrelated CRUD/model mutations',()=>{
  const p=createV2VoicePlan();for(const id of ['CRUD-02','CRUD-04','CRUD-06','CRUD-08','CRUD-09','AI-S1-09']){
    const b=p.caseBindings.find(x=>x.caseId===id);assert.equal(b.requiresModel,false);assert.deepEqual(b.operationIds,[`ui-${id.toLowerCase()}`,`read-${id.toLowerCase()}`]);
  }
});
test('authorized physical corrections are exact and do not change baseline control file',()=>{
  const p=createV2VoicePlan();for(const role of ['single','three'])assert.equal(p.operations.find(x=>x.id===`s5-prototype-${role}-image-generate`).kind,'write');
  for(const suffix of ['initial-native-projection','reviewed-response-projection'])assert.equal(p.operations.find(x=>x.id==='s1-problem-main-'+suffix),undefined,'local projection assertions must not invent another physical/read operation');
  assert.equal(p.operations.find(x=>x.id==='s6-test-survey-source-binding').kind,'write');
  const permission=p.operations.filter(x=>/-asr-(audio|publish)-permission-once$/.test(x.id));assert.equal(permission.length,4);assert(permission.every(x=>x.kind==='write'));
  assert.equal(p.printJobs.length,111);assert.equal(p.limits.teaching,57);assert.equal(p.limits.design,3);
});
test('case begins and consumes UI/read claims before any action; incomplete assertions remain blocked',async()=>{
  const f=fixture();const c=await beginV2Case(f);
  let status=f.ledger.summary();assert.equal(status.cases.find(x=>x.caseId==='CRUD-02').status,'RUNNING');
  assert.equal(status.operations.find(x=>x.id==='ui-crud-02').status,'SENT');
  await c.action(async()=>{});const result=await c.finish({refresh:async()=>{}});
  assert.equal(result.status,'BLOCKED');assert(result.missingAssertions.includes('all-supported-create-kinds'));
  assert.equal(f.ledger.summary().fullAcceptancePassed,false);assert.equal(f.shots.length,3);
});
test('changed refresh contents cannot be passed even at the same revision',async()=>{
  const f=fixture();const c=await beginV2Case(f);await c.action(async()=>{});
  await assert.rejects(c.finish({refresh:async()=>{f.ui.stage=async()=>({...stage,content:{draft:{fields:{sibling:'changed'}}}});}}),/V2_CASE_ASSERTION_REFRESH_PRESERVES_SAVED_CONTENT/);
});
test('assertion record needs actual observed value and cannot fabricate a missing generic true',async()=>{
  const c=await beginV2Case(fixture());assert.throws(()=>c.record('cancel-button',true),/V2_CASE_OBSERVATION_INVALID/);
  assert.throws(()=>c.record('invented-case-greened',true,{}),/V2_CASE_OBSERVATION_INVALID/);
});
test('receipt rejects cross-project readback, missing exact screenshots and incomplete assertions',()=>{
  const binding={caseId:'CRUD-02',entityRole:'main',assertionIds:['specific-proof']},good={...stage};
  const base={binding,assertions:[{id:'specific-proof',passed:true,evidenceSha256:'f'.repeat(64)}],after:good,refreshed:good,scope,screenshots:['before','result','refreshed'].map(kind=>({filename:`V2N-CRUD-02-${kind}.png`,kind,sha256:'e'.repeat(64),bytes:1024}))};
  assert.equal(assertV2CaseReceipt(base).serverReadback.revision,7);
  assert.throws(()=>assertV2CaseReceipt({...base,refreshed:{...stage,projectId:'another'}}),/V2_CASE_READBACK_SCOPE_INVALID/);
  assert.throws(()=>assertV2CaseReceipt({...base,screenshots:base.screenshots.slice(1)}),/V2_REAL_CASE_SCREENSHOTS_MISSING/);
  assert.throws(()=>assertV2CaseReceipt({...base,assertions:[]}),/V2_REAL_CASE_ASSERTIONS_INCOMPLETE/);
});
test('candidate run binding rejects wrong thread, absent source versions and wrong stage',()=>{
  const proof={runId:'run-1',assistantMessageId:'message-1',threadId:'thr-1',sourceRevisions:{1:7}},target={stageId:1,threadId:'thr-1'};
  assert.equal(assertV2CancelRun(proof,{stageId:1,target}),true);
  assert.throws(()=>assertV2CancelRun({...proof,threadId:'thr-2'},{stageId:1,target}),/V2_CANCEL_REAL_BOUND_REPLY_REQUIRED/);
  assert.throws(()=>assertV2CancelRun({...proof,sourceRevisions:{}},{stageId:1,target}),/V2_CANCEL_REAL_BOUND_REPLY_REQUIRED/);
  assert.throws(()=>assertV2CancelRun(proof,{stageId:2,target}),/V2_CANCEL_ENTITY_STAGE_CHANGED/);
});
test('create cancellation catalog uses real ten kinds; methods and PDF are not fabricated entities',()=>{
  assert.equal(new Set(V2_CREATE_CANCEL_KINDS.map(x=>x.kind)).size,10);
  assert.deepEqual(V2_CREATE_CANCEL_KINDS.filter(x=>x.stage===2).map(x=>x.kind),['interview','observation']);
  assert(!V2_CREATE_CANCEL_KINDS.some(x=>['method','tag','pdf'].includes(x.kind)));
  assert.equal(V2_CREATE_CANCEL_KINDS.find(x=>x.kind==='brainstorm').hostRegion,'头脑风暴');
});

test('canonical survey report uses eight exact one-use UI submission slots, never the old singleton',()=>{
  const p=createV2VoicePlan(),slots=p.operations.filter(row=>/^s6-test-survey-native-participant-submit-/.test(row.id));
  assert.equal(slots.length,8);assert.equal(p.operations.some(row=>row.id==='s6-test-survey-native-participant-submit'),false);
  assert.deepEqual(slots.map(row=>row.id.slice(-2)),['01','02','03','04','05','06','07','08']);
  assert(slots.every(row=>row.kind==='survey'&&row.caseIds.includes('AI-S6-15')));
});

test('only new-profile CRUD-02 accepts 256 actual actions; 257 and sibling 129 are rejected',async()=>{
  const f=fixture(),c=await beginV2Case(f);for(let i=0;i<255;i++)await c.action(async()=>{});
  for(const id of c.binding.assertionIds.filter(x=>!['refresh-preserves-saved-content','real-screenshots'].includes(x)))c.record(id,true,{pureControlFixture:true,id});
  const result=await c.finish({refresh:async()=>{}});assert.equal(result.status,'PASSED');assert.equal(result.evidence.actualUiActions,256);
  const second=await beginV2Case(fixture());for(let i=0;i<256;i++)await second.action(async()=>{});await assert.rejects(second.action(async()=>{}),/V2_CASE_ACTION_BOUND/);
  const f3=fixture('AI-S1-09'),third=await beginV2Case(f3);for(let i=0;i<128;i++)await third.action(async()=>{});await assert.rejects(third.action(async()=>{}),/V2_CASE_ACTION_BOUND/);
});

test('service rejection proof accepts only exact owned stage server 403/409, not route abort or frontend hiding',async()=>{
  const {assertV2ServiceRejection}=await import('../../apps/web/e2e/support/devapp-aidt-v2-negative-service.mjs');
  const input={origin:'https://devapp.boardx.us',projectId:scope.projectId,stageId:2,method:'PUT',url:`https://devapp.boardx.us/api/projects/${scope.projectId}/aidt/stages/2`,status:409,expectedStatus:409};
  assert.equal(assertV2ServiceRejection(input).status,409);
  for(const patch of [{status:200},{status:0},{method:'GET'},{expectedStatus:500},{url:'https://another.test'+new URL(input.url).pathname},{url:input.url+'?substitute=true'}])assert.throws(()=>assertV2ServiceRejection({...input,...patch}),/V2_REJECTION_NOT_REAL_OWNED_STAGE_RESPONSE/);
});

test('pure cancellation control walks select/edit/abandon and never sends the positive run or saves shared content',async()=>{
  const f=fixture('AI-S1-05'),state={selected:false,replacement:false,local:false,text:'模型候选',requests:[],actions:[]};
  const locator=(kind,index=0)=>({kind,index,count:async()=>kind==='radio'?2:kind==='checkbox'?1:1,first:()=>locator(kind,0),nth:i=>locator(kind,i),
    getByRole:(role)=>locator(role),getByLabel:()=>locator('field'),
    check:async()=>{state.actions.push(kind+':check');if(kind==='radio')state.selected=true;if(kind==='checkbox')state.replacement=true;},
    inputValue:async()=>state.text,fill:async text=>{state.actions.push('field:fill');state.text=text;},
  });
  const host=locator('host'),editor=locator('editor');
  const page={getByRole:(role,{name})=>name==='聚焦本轮研究命题'?host:editor,getByTestId:()=>locator('workspace'),reload:async()=>{state.local=false;},};
  const check=(value)=>({toBeVisible:async()=>{if(value.kind==='editor')assert.equal(state.local,true);},not:{toBeVisible:async()=>assert.equal(state.local,false),toBeChecked:async()=>assert.equal(state.selected,false)},toBeChecked:async()=>assert.equal(state.selected,true),
    toBeDisabled:async()=>assert.equal(!(state.selected&&state.replacement),true),toBeEditable:async()=>{},toHaveValue:async text=>assert.equal(state.text,text)});
  check.poll=perform=>({toBeGreaterThan:async n=>assert((await perform())>n)});
  Object.assign(f.ui,{page,expect:check,scope,route:()=>({stageId:1,entityId:'entity-main',threadId:'thr-1'}),
    btn:name=>({kind:'button',name}),click:async value=>{state.actions.push(value.name);if(value.name==='采用到草稿')state.local=true;if(value.name==='保留已保存内容，放弃此草稿')state.local=false;},
    unchanged:async(_stage,observed)=>assert.deepEqual(observed,stage),go:async()=>{state.local=false;},
  });
  const proof={runId:'run-cancel',assistantMessageId:'msg-cancel',threadId:'thr-1',sourceRevisions:{1:7}};
  const result=await runV2CandidateCancellation({...f,observeNativeAction:async({operationId,perform})=>{
    state.requests.push(operationId);f.ledger.claimOperation(operationId,scope);f.ledger.markOperationSent(operationId,scope);await perform();
    f.ledger.settleOperation(operationId,{scope,outcome:'succeeded',receipt:{verified:true,sha256:'d'.repeat(64),httpStatus:200}});return proof;
  },modelReceipt:{runId:'run-cancel',threadId:'thr-1',stageId:1,sourceRevision:scope.source,providerObserved:true,substitute:false,settled:true}});
  assert.equal(result.status,'PASSED');assert.deepEqual(state.requests,['s1-problem-main-candidate-cancel']);
  assert(state.actions.includes('field:fill'));assert(state.actions.includes('保留已保存内容，放弃此草稿'));
  assert.equal(f.ledger.summary().operations.find(row=>row.id==='s1-problem-main-problem-candidate').status,'NOT_RUN');
  assert.deepEqual(await f.ui.stage(1),stage);assert.equal(f.shots.length,3);
});
