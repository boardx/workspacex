import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createV2AcceptanceGuard, acceptanceIdentity } from './devapp-aidt-v2-request-guard.mjs';
import { createV2VoicePlan } from './devapp-aidt-v2-plan.mjs';
import { createV2ExecutionLedger } from './devapp-aidt-v2-profile.mjs';
const origin='https://devapp.boardx.us', project='prj-11111111-1111-4111-8111-111111111111', entity='11111111-1111-4111-8111-222222222222';
const surveyId='qa-survey-456', token='synthetic-public-token-456', questions=[{id:'q1',title:'合成问题一',type:'single',options:['甲','乙']},{id:'q2',title:'合成问题二',type:'open'}];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const url=path=>origin+path;
function setup(){
 let ledger,scope,clock=100;
 const identity={...acceptanceIdentity({EXPECTED_SOURCE_SHA:'a'.repeat(40),EXPECTED_RELEASE_TAG:'123-1',GITHUB_RUN_ID:'456',GITHUB_RUN_ATTEMPT:'1'}),controlSource:'b'.repeat(40)};
 const plan=createV2VoicePlan(),guard=createV2AcceptanceGuard(identity,{plan,ledger:()=>ledger,runtimeScope:()=>scope,now:()=>clock});
 const request=(method,path,body)=>guard.decide({url:url(path),method,body,resourceType:'fetch'});
 guard.armLogin(); let d=request('POST','/api/auth/login',{email:'synthetic-unit-fixture-not-an-account',password:'synthetic-unit-fixture-not-an-account'});assert.equal(d.allow,true);
 guard.observe(d,200,{userId:'qa-user',orgs:['qa-org'],sessionToken:'synthetic-unit-token',expiresAt:'2099-01-01T00:00:00Z'});guard.verifyOrdinaryIdentity(200,{org:{id:'qa-org'},orgRole:'consultant'});
 guard.armProjectCreate();d=request('POST','/api/projects',{orgId:'qa-org',name:identity.projectName,kind:'general',blueprintVersionId:null,profile:'aidt'});assert.equal(d.allow,true);
 guard.observe(d,201,{id:project,kind:'general',status:'active'});guard.bindOwnedProject({projectId:project,name:identity.projectName},[{userId:'qa-user',role:'owner'}]);
 scope={source:identity.source,controlSource:identity.controlSource,tag:identity.tag,run:identity.run,attempt:identity.attempt,orgId:'qa-org',actorId:'qa-user',orgRole:'consultant',projectId:project};ledger=createV2ExecutionLedger(plan,scope,()=>clock);
 const arm=(operationId,requestKind,expectedFields,extra={})=>{const row=plan.operations.find(item=>item.id===operationId);guard.armV2Operation({operationId,kind:row?.kind??'survey',requestKind,stageId:row?.stage??6,entityRole:row?.entityRole??'test-survey',entityId:entity,expectedFields,...extra});};
 arm('s5-prototype-three-create-design','design-create',{name:'QA 456 design'});guard.armDesignCreate({name:'QA 456 design'});d=request('POST','/api/pm-designs',{name:'QA 456 design',template:'ui'});assert.equal(d.allow,true);guard.observe(d,201,{project:{id:'qa-design',ownerId:'qa-user',name:'QA 456 design',template:'ui',frames:[],share:null}});
 d=request('GET',`/api/projects/${project}/aidt/stages/6`);assert.equal(d.allow,true);guard.observe(d,200,{stage:{projectId:project,stageId:6,revision:1,content:{schemaVersion:1,draft:{fields:{['testGroup:'+entity]:JSON.stringify({id:entity,method:'survey',designId:'qa-design',versionId:'native-v1',planFromMessageId:'qa-plan'})},ideas:[],selectedIdeaId:''}},sourceStageRevisions:[]}});guard.armSurvey(entity);
 const title='QA 456 survey';arm('s6-test-survey-native-create','survey-create',{title});d=request('POST','/api/surveys',{title,questions,tags:['QA'],template:{id:'qa-template',sections:[]}});assert.equal(d.allow,true);guard.observe(d,201,{id:surveyId,title,status:'draft',responses:[],publication:null,version:1});
 arm('s6-test-survey-native-link','survey-link',{}, {resourceId:surveyId});d=request('POST',`/api/projects/${project}/resources`,{kind:'survey',projectId:project,resourceId:surveyId});assert.equal(d.allow,true);guard.observe(d,201,{});
 arm('s6-test-survey-native-publish','survey-publish',{expectedVersion:1},{resourceId:surveyId});d=request('POST',`/api/surveys/${surveyId}/publish`,{expectedVersion:1});assert.equal(d.allow,true);guard.observe(d,200,{id:surveyId,version:2,publication:{status:'collecting',token,version:1,questions}});
 const publication=guard.surveyPublication();assert.deepEqual(publication,{surveyId,version:1,questionsSha256:hash(questions)});
 const publicGet=(patch={},authenticated=false)=>{const path=`/api/public/surveys/${token}`;const decision=authenticated?request('GET',path):guard.decideSurveyParticipant({url:url(path),method:'GET'});assert.equal(decision.allow,true);guard.observe(decision,200,{id:surveyId,version:1,alreadySubmitted:false,questions,...patch});return decision;};
 const armSubmit=(index,fields={})=>arm(`s6-test-survey-native-participant-submit-${String(index).padStart(2,'0')}`,'survey-submit',{answers:answers(index),surveyPublication:publication,...fields},{resourceId:surveyId});
 const submit=(index,patch={})=>guard.decideSurveyParticipant({url:url(`/api/public/surveys/${token}/responses`),method:'POST',body:{answers:answers(index),durationSeconds:65,submissionId:randomUUID(),...patch}});
 const ack=(decision,index,status=201,patch={})=>guard.observe(decision,status,{responseId:'qa-response-'+index,replayed:false,...patch});
 return {guard,plan,ledger,request,publicGet,armSubmit,submit,ack,publication,arm,tick:value=>{clock=value;}};
}
function answers(index){return[{questionId:'q1',value:index%2?'甲':'乙'},{questionId:'q2',value:'合成第'+index+'份完整回答'}];}

test('eight distinct anonymous submissions each consume one exact ordered slot and acknowledged response',()=>{
 const f=setup();const ids=new Set();for(let index=1;index<=8;index++){f.publicGet();f.armSubmit(index);const submissionId=randomUUID();ids.add(submissionId);const decision=f.submit(index,{submissionId});assert.equal(decision.allow,true,JSON.stringify(decision));assert.equal(decision.operationId,`s6-test-survey-native-participant-submit-${String(index).padStart(2,'0')}`);f.ack(decision,index);}
 assert.equal(ids.size,8);assert.equal(f.guard.surveyReceipt().responseId,'qa-response-8');assert.equal(f.guard.fatal(),null);
 assert.equal(f.ledger.summary().operations.filter(item=>/participant-submit/.test(item.id)&&item.status==='SUCCEEDED').length,8);
});
test('the added eight slots do not change baseline 44 turns, 263 writes or once-only slot arming',()=>{
 const old=readFileSync(new URL('./devapp-aidt-acceptance-guard.mjs',import.meta.url),'utf8');assert.match(old,/TEACHING_TURN_LIMIT = 44/);assert.match(old,/WRITE_LIMIT = 128 \+ 9 \* 15/);
 const f=setup();f.publicGet();f.armSubmit(1);assert.equal(f.submit(1).allow,true);assert.throws(()=>f.armSubmit(1),/V2_REQUEST_SLOT_INVALID/);
});
test('a participant cannot submit without an observed anonymous public GET',()=>{const f=setup();f.armSubmit(1);assert.equal(f.submit(1).allow,false);});
for(const [name,patch]of[['another survey',{surveyId:'foreign'}],['another publication',{version:2}],['different full question schema',{questionsSha256:'d'.repeat(64)}]])test('rejects ticket for '+name,()=>{const f=setup();f.publicGet();f.armSubmit(1,{surveyPublication:{...f.publication,...patch}});assert.equal(f.submit(1).allow,false);});
for(const [name,patch]of[['wrong publication',{version:2}],['changed question schema',{questions:[{...questions[0],title:'变更后的题目'},questions[1]]}],['already submitted',{alreadySubmitted:true}]])test('public GET observation rejects '+name,()=>{const f=setup();assert.throws(()=>f.publicGet(patch),/V2_SURVEY_SCOPE_REJECTED/);});
test('rejects changed answers instead of accepting a ticket for different UI values',()=>{const f=setup();f.publicGet();f.armSubmit(1);assert.equal(f.submit(1,{answers:answers(2)}).allow,false);});
test('refuses skipping the first or next named participant slot',()=>{for(const skip of[2,8]){const f=setup();f.publicGet();f.armSubmit(skip);assert.equal(f.submit(skip).allow,false);}const f=setup();f.publicGet();f.armSubmit(1);f.ack(f.submit(1),1);f.publicGet();f.armSubmit(3);assert.equal(f.submit(3).allow,false);});
test('rejects an unplanned ninth participant slot',()=>{const f=setup();assert.throws(()=>f.armSubmit(9),/V2_REQUEST_SLOT_INVALID/);});
test('does not spend the next slot while the prior submission acknowledgement is unknown',()=>{const f=setup();f.publicGet();f.armSubmit(1);const first=f.submit(1);assert.equal(first.allow,true);f.publicGet();f.armSubmit(2);assert.equal(f.submit(2).allow,false);});
test('rejects a repeated submission UUID across otherwise distinct slots',()=>{const f=setup(),submissionId=randomUUID();f.publicGet();f.armSubmit(1);const first=f.submit(1,{submissionId});f.ack(first,1);f.publicGet();f.armSubmit(2);assert.equal(f.submit(2,{submissionId}).allow,false);});
test('rejects replayed or duplicate server response receipts',()=>{for(const patch of[{replayed:true},{responseId:'qa-response-1'}]){const f=setup();f.publicGet();f.armSubmit(1);const first=f.submit(1);f.ack(first,1);f.publicGet();f.armSubmit(2);const second=f.submit(2);assert.equal(second.allow,true);assert.throws(()=>f.ack(second,2,201,patch),/V2_SURVEY_SCOPE_REJECTED/);}});
test('a failed HTTP acknowledgement cannot authorize a further participant',()=>{const f=setup();f.publicGet();f.armSubmit(1);const first=f.submit(1);assert.throws(()=>f.ack(first,1,503),/V2_SURVEY_SCOPE_REJECTED/);f.publicGet();f.armSubmit(2);assert.equal(f.submit(2).allow,false);});
test('an authenticated-owner public read cannot substitute for anonymous participant schema observation',()=>{const f=setup();f.publicGet({},true);f.armSubmit(1);assert.equal(f.submit(1).allow,false);});

test('each next participant must observe its own fresh anonymous public schema rather than borrowing the first GET',()=>{const f=setup();f.publicGet();f.armSubmit(1);f.ack(f.submit(1),1);f.armSubmit(2);assert.equal(f.submit(2).allow,false);});

test('an anonymous schema observation older than 15 seconds cannot authorize a fresh submit slot',()=>{const f=setup();f.publicGet();f.tick(15101);f.armSubmit(1);assert.equal(f.submit(1).allow,false);});
test('a future schema observation is not accepted as a current prerequisite',()=>{const f=setup();f.publicGet();f.tick(99);f.armSubmit(1);assert.equal(f.submit(1).allow,false);});
test('cloned or fabricated public-read decisions cannot assign participant authority',()=>{for(const fabricated of[false,true]){const f=setup();const issued=f.guard.decideSurveyParticipant({url:url(`/api/public/surveys/${token}`),method:'GET'});const decision=fabricated?{allow:true,kind:'survey-public-read'}:{...issued};assert.throws(()=>f.guard.observe(decision,200,{id:surveyId,version:1,alreadySubmitted:false,questions}),/V2_SURVEY_SCOPE_REJECTED/);f.armSubmit(1);assert.equal(f.submit(1).allow,false);}});
test('a consumed anonymous schema observation cannot be replayed as a second observation',()=>{const f=setup();const decision=f.publicGet();assert.throws(()=>f.guard.observe(decision,200,{id:surveyId,version:1,alreadySubmitted:false,questions}),/V2_SURVEY_SCOPE_REJECTED/);});
