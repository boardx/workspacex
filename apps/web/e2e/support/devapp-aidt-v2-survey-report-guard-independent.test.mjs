import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createV2AcceptanceGuard, acceptanceIdentity } from './devapp-aidt-v2-request-guard.mjs';
import { createV2VoicePlan } from './devapp-aidt-v2-plan.mjs';
import { createV2ExecutionLedger } from './devapp-aidt-v2-profile.mjs';
const origin='https://devapp.boardx.us', project='prj-11111111-1111-4111-8111-111111111111', entity='11111111-1111-4111-8111-222222222222';
const surveyId='qa-survey-456', token='synthetic-public-token-456', questions=[{id:'q1',title:'合成问题一',type:'single',options:['甲','乙'],chapterId:'',order:1,required:true},{id:'q2',title:'合成问题二',type:'open',options:[],chapterId:'',order:2,required:true}];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const url=path=>origin+path;
function setup(){
 let ledger,scope,clock=100;
 const identity={...acceptanceIdentity({EXPECTED_SOURCE_SHA:'a'.repeat(40),EXPECTED_RELEASE_TAG:'123-1',GITHUB_RUN_ID:'456',GITHUB_RUN_ATTEMPT:'1'}),controlSource:'b'.repeat(40)};
 const plan=createV2VoicePlan(),guard=createV2AcceptanceGuard(identity,{plan,ledger:()=>ledger,runtimeScope:()=>scope,now:()=>clock});
 const request=(method,path,body)=>guard.decide({url:url(path),method,body,resourceType:'fetch'});
 guard.armLogin(); let d=request('POST','/api/auth/login',{email:'synthetic-unit-fixture-not-an-account',password:'test-only-fixture'});assert.equal(d.allow,true);
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
 return {guard,plan,ledger,request,publicGet,armSubmit,submit,ack,publication,arm,tick:value=>{clock=value;},scope:patch=>{scope={...scope,...patch};}};
}
function answers(index){return[{questionId:'q1',value:index%2?'甲':'乙'},{questionId:'q2',value:'合成第'+index+'份完整回答'}];}


// API-shaped owner runtime and compiled report. No HTTP, account, compiler
// provider, browser, or model is called by these request-protocol tests.
function ready(count=8) {
 const f=setup();
 for(let i=1;i<=count;i++){f.publicGet();f.armSubmit(i);const d=f.submit(i);assert.equal(d.allow,true);f.ack(d,i);}
 f.runtime={id:surveyId,title:'QA 456 survey',questions,template:{id:'qa-template',title:'QA report',sections:[]},tags:['QA'],version:2,status:'collecting',anonymity:'anonymous',answerRevision:8,updatedAt:'2026-11-22T08:00:00Z',responses:Array.from({length:8},(_,i)=>({id:'qa-response-'+(i+1),quality:'normal',analysis:'included',role:'合成QA',companySize:'合成QA',durationSeconds:65,answers:answers(i+1),submittedAt:'2026-11-22T08:00:00Z'})),publication:{status:'collecting',token,version:1,questions,expiresAt:'2026-12-01T08:00:00Z'},report:null,reportBasisVersion:null,reportBasisAnswerRevision:null,reportGeneratedAt:null};
 f.ownerGet=(patch={})=>{const d=f.request('GET',`/api/surveys/${surveyId}`);assert.equal(d.allow,true);f.guard.observe(d,200,{...structuredClone(f.runtime),...patch});return d;};
 f.armReport=(extra={})=>f.arm('s6-test-survey-native-report','survey-report',{expectedVersion:2},{resourceId:surveyId,...extra});
 f.compile=(body={expectedVersion:2},path=`/api/surveys/${surveyId}/report`)=>f.request('POST',path,body);
 f.result=()=>({...structuredClone(f.runtime),version:3,reportBasisVersion:2,reportBasisAnswerRevision:8,reportGeneratedAt:'2026-11-22T08:01:00Z',report:{id:'qa-report',title:'合成八份答卷概览',issues:[],sampleSummary:{total:8,included:8,excluded:0,pendingReview:0},sections:[{id:'section',title:'八份完整开放题回答',blocks:[{id:'block',title:'合成回答',type:'table',questionIds:['q2'],statistic:'count',samplePolicy:'valid',minGroupSize:8,sampleSize:8,rows:[{label:'回答数',value:8,count:8}],answerTexts:Array.from({length:8},(_,i)=>({label:'合成答卷'+(i+1),value:'合成回答'+(i+1)})),issues:[]}]}]}});
 return f;
}
test('eight individually acknowledged responses and a fresh exact owner GET allow only one pure compile with unchanged answer revision',()=>{
 const f=ready();f.ownerGet();f.armReport();const d=f.compile();assert.equal(d.allow,true,JSON.stringify(d));assert.equal(d.kind,'survey-report');assert.equal(d.beforeVersion,2);assert.equal(d.beforeAnswerRevision,8);f.guard.observe(d,200,f.result());
 assert.equal(f.guard.fatal(),null);assert.equal(f.ledger.summary().operations.find(row=>row.id==='s6-test-survey-native-report').status,'SUCCEEDED');assert.throws(()=>f.armReport(),/V2_REQUEST_SLOT_INVALID/);assert.equal(f.compile().allow,false);
});
for(const [name,patch]of [
 ['publication question schema',{publication:{status:'collecting',token,version:1,questions:[{...questions[0],title:'其他题'},questions[1]]}}],
 ['publication version',{publication:{status:'collecting',token,version:2,questions}}],
 ['publication token',{publication:{status:'collecting',token:'foreign',version:1,questions}}],
 ['duplicate included response',{responses:Array.from({length:8},(_,i)=>({id:'qa-response-1',analysis:'included',answers:answers(i+1)}))}],
 ['unacknowledged response',{responses:Array.from({length:8},(_,i)=>({id:i===7?'unacknowledged':'qa-response-'+(i+1),analysis:'included',answers:answers(i+1)}))}],
 ['excluded response',{responses:Array.from({length:8},(_,i)=>({id:'qa-response-'+(i+1),analysis:i===7?'excluded':'included',answers:answers(i+1)}))}],
 ['incomplete answer list',{responses:Array.from({length:8},(_,i)=>({id:'qa-response-'+(i+1),analysis:'included',answers:i===7?answers(i+1).slice(0,1):answers(i+1)}))}],
])test('compile rejects mismatching '+name,()=>{const f=ready();f.ownerGet(patch);f.armReport();assert.equal(f.compile().allow,false);});
test('compile requires the fresh owner runtime GET, never just the public schema',()=>{const f=ready();f.publicGet();f.armReport();assert.equal(f.compile().allow,false);});
test('compile rejects an owner runtime observation older than 15 seconds',()=>{const f=ready();f.ownerGet();f.tick(15101);f.armReport();assert.equal(f.compile().allow,false);});
test('compile rejects a future runtime observation',()=>{const f=ready();f.ownerGet();f.tick(99);f.armReport();assert.equal(f.compile().allow,false);});
test('seven acknowledged responses cannot borrow an eighth runtime ID',()=>{const f=ready(7);f.ownerGet();f.armReport();assert.equal(f.compile().allow,false);});
for(const field of ['actorId','orgId','orgRole','projectId'])test('compile cannot transfer the observed owner runtime to a different '+field,()=>{const f=ready();f.ownerGet();f.scope({[field]:'different'});assert.throws(()=>f.armReport(),/V2_RUNTIME_SCOPE_UNVERIFIED/);});
for(const [name,change]of [
 ['unchanged version',r=>{r.version=2;}],['skipped version',r=>{r.version=4;}],['changed answer revision',r=>{r.answerRevision=9;}],['different basis version',r=>{r.reportBasisVersion=1;}],['different answer basis',r=>{r.reportBasisAnswerRevision=7;}],
 ['empty report',r=>{r.report=null;}],['empty sections',r=>{r.report.sections=[];}],['empty blocks',r=>{r.report.sections[0].blocks=[];}],['seven included sample',r=>{r.report.sampleSummary.included=7;}],['seven row sample',r=>{r.report.sections[0].blocks[0].rows[0].count=7;}],['seven answer texts',r=>{r.report.sections[0].blocks[0].answerTexts.pop();}],['report issue',r=>{r.report.issues=['privacy'];}],['block issue',r=>{r.report.sections[0].blocks[0].issues=['insufficient'];}],['foreign response',r=>{r.responses[7].id='foreign-response';}],
])test('compile receipt rejects '+name,()=>{const f=ready();f.ownerGet();f.armReport();const d=f.compile();assert.equal(d.allow,true);const r=f.result();change(r);assert.throws(()=>f.guard.observe(d,200,r),/V2_SURVEY_SCOPE_REJECTED/);});
for(const [name,body,path]of [
 ['model provider flag',{expectedVersion:2,provider:'external'}],['model request flag',{expectedVersion:2,modelId:'external'}],['generation endpoint',{expectedVersion:2},`/api/surveys/${surveyId}/report/generate`],['markdown model proposal',{expectedVersion:2},'/api/surveys/markdown-proposals'],['foreign survey',{expectedVersion:2},'/api/surveys/foreign/report'],
])test('compile slot never permits '+name,()=>{const f=ready();f.ownerGet();f.armReport();assert.equal(f.compile(body,path).allow,false);});
test('fabricated owner-read decisions cannot seed compile authorization',()=>{const f=ready();const d=f.request('GET',`/api/surveys/${surveyId}`);assert.equal(d.allow,true);assert.throws(()=>f.guard.observe({...d},200,f.runtime),/V2_SURVEY_SCOPE_REJECTED/);f.armReport();assert.equal(f.compile().allow,false);});

test('an unpublished current draft may differ while compile stays bound to the exact published schema and answer basis',()=>{
 const f=ready();
 // SurveyService.report intentionally compiles publication.questions first.
 // The editable current draft is not a second publication or permission grant.
 f.runtime.questions=[{...questions[0],title:'尚未发布的当前草稿题目'},questions[1]];
 assert.notDeepEqual(f.runtime.questions,f.runtime.publication.questions);
 f.ownerGet();f.armReport();const d=f.compile();assert.equal(d.allow,true);
 const receipt=f.result();
 assert.deepEqual(receipt.publication.questions,questions);
 assert.equal(receipt.publication.version,f.publication.version);
 assert.equal(hash(receipt.publication.questions),f.publication.questionsSha256);
 assert.equal(receipt.answerRevision,8);assert.equal(receipt.reportBasisAnswerRevision,8);
 assert.equal(receipt.reportBasisVersion,2);assert.equal(receipt.version,3);
 f.guard.observe(d,200,receipt);assert.equal(f.guard.fatal(),null);
 assert.equal(f.ledger.summary().operations.find(row=>row.id==='s6-test-survey-native-report').status,'SUCCEEDED');
});
