import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { validateTeachingWire, teachingHistoryFailureDiagnostic, readTeachingHistoryFailureDiagnostic, sendTeachingFeedback } from '../../apps/web/e2e/support/devapp-aidt-chat-evidence.mjs';
import { ProbeFailure } from '../../apps/web/e2e/support/devapp-aidt-auth-readonly.mjs';
const scope = () => ({ origin:'https://devapp.boardx.us', projectId:'qa-project',stageId:2,threadId:'qa-thread',actorId:'qa-actor',prompt:'合成 QA 第二轮访谈提问，请继续协助完善。',skillId:'qa-skill',skillVersionId:'qa-version',selector:{schemaVersion:1,purpose:'stage',projectId:'qa-project',stageId:2,entityId:'qa-interview',stageRevisions:[{stageId:1,revision:4},{stageId:2,revision:2}]},knownMessages:[] });
const human={id:'private-durable-human-123',clientMessageId:'private-client-human-123',authorKind:'human',text:'private-synthetic-human-body-123'};
const agent={id:'private-durable-agent-123',authorKind:'agent',text:'private-synthetic-agent-body-123'};
const message=(row,overrides={})=>({id:row.id,role:row.authorKind==='human'?'user':'assistant',content:row.text,...overrides});
function request(s,history){return {method:'POST',url:s.origin+'/api/copilotkit/agent/default/run',body:{threadId:'sdk-thread',runId:'sdk-run',messages:[...history,{id:'next-client',role:'user',content:s.prompt}],forwardedProps:{chatThreadId:s.threadId,clientMessageId:'next-client',aidtContext:s.selector}}};}
function failure(s,history){try{validateTeachingWire(request(s,history),s);assert.fail('guard should still reject');}catch(error){assert.equal(error.code,'TEACHING_HISTORY_NOT_CANONICAL');return error;}}
const schema=['messageCount','historyCount','firstBadIndex','idMatchesDurable','idMatchesKnownClientAlias','roleMatches','textExact','textTrimEqual','anyCanonicalTextExact','contentShape'].sort();
function checkClosed(value){assert.deepEqual(Object.keys(value).sort(),schema);assert.ok(Object.isFrozen(value));assert.ok(JSON.stringify(value).length<400);for(const forbidden of ['private-','sdk-','qa-project','qa-thread','body','Bearer','prompt'])assert.ok(!JSON.stringify(value).includes(forbidden));}
function attach(value,code='TEACHING_HISTORY_NOT_CANONICAL'){const error=new ProbeFailure(code);Object.defineProperty(error,'teachingHistoryDiagnostic',{value});return error;}
const valid=()=>teachingHistoryFailureDiagnostic([message(human,{id:human.clientMessageId}),{id:'latest',role:'user',content:'last'}],[human,agent],0);

test('same-page human client alias remains rejected but yields exactly bounded safe diagnostic',()=>{
 const s={...scope(),knownMessages:[human,agent]},error=failure(s,[message(human,{id:human.clientMessageId})]);
 const d=readTeachingHistoryFailureDiagnostic(error);checkClosed(d);
 assert.deepEqual(d,{messageCount:2,historyCount:2,firstBadIndex:0,idMatchesDurable:false,idMatchesKnownClientAlias:true,roleMatches:true,textExact:true,textTrimEqual:true,anyCanonicalTextExact:true,contentShape:'text'});
 assert.equal(Object.getOwnPropertyDescriptor(error,'teachingHistoryDiagnostic').enumerable,false);
 assert.ok(!JSON.stringify(error).includes('private-'));assert.ok(!Object.keys(error).includes('teachingHistoryDiagnostic'));
});
test('assistant unknown stream ID remains rejected; equal canonical text never invents an ID mapping',()=>{
 const s={...scope(),knownMessages:[human,agent]},d=readTeachingHistoryFailureDiagnostic(failure(s,[message(agent,{id:'private-stream-123'})]));checkClosed(d);
 assert.equal(d.idMatchesDurable,false);assert.equal(d.idMatchesKnownClientAlias,false);assert.equal(d.roleMatches,false);assert.equal(d.textExact,false);assert.equal(d.anyCanonicalTextExact,true);
});
test('durable ID plus trimmed-only body remains rejected and reports trim without raw body',()=>{
 const s={...scope(),knownMessages:[agent]},d=readTeachingHistoryFailureDiagnostic(failure(s,[message(agent,{content:'  '+agent.text+'\n'})]));
 checkClosed(d);assert.equal(d.idMatchesDurable,true);assert.equal(d.roleMatches,true);assert.equal(d.textExact,false);assert.equal(d.textTrimEqual,true);assert.equal(d.anyCanonicalTextExact,false);
});
test('wrong role remains rejected even when ID and text are exact',()=>{
 const d=readTeachingHistoryFailureDiagnostic(failure({...scope(),knownMessages:[agent]},[message(agent,{role:'user'})]));checkClosed(d);assert.equal(d.roleMatches,false);assert.equal(d.textExact,true);
});
test('diagnostic identifies first failed history index, not last or latest human',()=>{
 const d=readTeachingHistoryFailureDiagnostic(failure({...scope(),knownMessages:[human,agent]},[message(human),message(agent,{id:'unknown-stream'})]));assert.equal(d.messageCount,3);assert.equal(d.firstBadIndex,1);
});
test('valid hydrated durable wire is unchanged and returns no added diagnostic',()=>{
 const s={...scope(),knownMessages:[human,agent]},wire=validateTeachingWire(request(s,[message(human),message(agent)]),s);
 assert.deepEqual(wire,{clientMessageId:'next-client',sdkRunId:'sdk-run',sdkThreadId:'sdk-thread'});
});
test('text parts are joined exactly only for booleans, never serialized in diagnostic',()=>{
 const d=readTeachingHistoryFailureDiagnostic(failure({...scope(),knownMessages:[human]},[message(human,{id:human.clientMessageId,content:[{type:'text',text:human.text.slice(0,9)},{type:'text',text:human.text.slice(9)}]})]));checkClosed(d);assert.equal(d.contentShape,'text-parts');assert.equal(d.textExact,true);
});
for(const [name,content,shape] of [['image',[{type:'image',url:'private-image-source'}],'nontext'],['object',{text:'private-body'},'other'],['null',null,'other']])test('content classification is closed for '+name,()=>{
 const d=teachingHistoryFailureDiagnostic([message(agent,{id:'unknown',content}),{id:'latest',role:'user',content:'last'}],[agent],0);checkClosed(d);assert.equal(d.contentShape,shape);assert.equal(d.textExact,false);
});
test('non-text canonical message keeps original NON_TEXT failure with no history diagnostic',()=>{
 const s={...scope(),knownMessages:[agent]};assert.throws(()=>validateTeachingWire(request(s,[message(agent,{content:[{type:'image'}]})]),s),error=>error.code==='TEACHING_NON_TEXT_MESSAGE'&&readTeachingHistoryFailureDiagnostic(error)===undefined);
});
for(const [name,mutate] of [
 ['extra raw ID',d=>({...d,messageId:'private-id'})],['extra raw body',d=>({...d,body:'private-body'})],
 ['symbol key',d=>({...d,[Symbol('private')]:true})],['message lower bound',d=>({...d,messageCount:1})],['message upper bound',d=>({...d,messageCount:101})],
 ['history lower bound',d=>({...d,historyCount:-1})],['history upper bound',d=>({...d,historyCount:101})],['latest index',d=>({...d,firstBadIndex:1})],
 ['negative index',d=>({...d,firstBadIndex:-1})],['fraction index',d=>({...d,firstBadIndex:0.5})],['bad enum',d=>({...d,contentShape:'private-text'})],
 ['nonboolean',d=>({...d,textExact:'true'})],['missing key',d=>{const {roleMatches,...rest}=d;return rest;}],
])test('reader drops malformed diagnostic: '+name,()=>assert.equal(readTeachingHistoryFailureDiagnostic(attach(mutate(valid()))),undefined));
test('reader rejects accessors without invoking them, both metadata and field',()=>{
 let reads=0;const outer=new ProbeFailure('TEACHING_HISTORY_NOT_CANONICAL');Object.defineProperty(outer,'teachingHistoryDiagnostic',{get(){reads++;return valid();}});
 assert.equal(readTeachingHistoryFailureDiagnostic(outer),undefined);const d={...valid()};Object.defineProperty(d,'textExact',{get(){reads++;return true;}});assert.equal(readTeachingHistoryFailureDiagnostic(attach(d)),undefined);assert.equal(reads,0);
});
test('reader discards plain or wrong-code errors and throwing proxies',()=>{
 assert.equal(readTeachingHistoryFailureDiagnostic({code:'TEACHING_HISTORY_NOT_CANONICAL',teachingHistoryDiagnostic:valid()}),undefined);
 assert.equal(readTeachingHistoryFailureDiagnostic(attach(valid(),'OTHER_FAILURE')),undefined);
 assert.equal(readTeachingHistoryFailureDiagnostic(attach(new Proxy({}, {ownKeys(){throw Error('private-error');}}))),undefined);
});
test('diagnostic refuses unbounded history/messages or latest index without changing guard',()=>{
 assert.equal(teachingHistoryFailureDiagnostic([message(human),message(agent)],[...Array(101)].map(()=>human),0),undefined);
 assert.equal(teachingHistoryFailureDiagnostic([...Array(101)].map(()=>message(human)),[human],0),undefined);
 assert.equal(teachingHistoryFailureDiagnostic([message(human),message(agent)],[human],1),undefined);
});
test('maximum permitted shape remains fixed-size and counts are exact',()=>{
 const d=teachingHistoryFailureDiagnostic([...Array(100)].map(()=>message(human)),[...Array(100)].map(()=>human),98);checkClosed(d);assert.equal(d.messageCount,100);assert.equal(d.historyCount,100);assert.equal(d.firstBadIndex,98);
});
test('normal sendTeachingFeedback throws the original bounded diagnostic before any run/model reads',async()=>{
 const s=scope(),r=request(s,[message(human,{id:human.clientMessageId})]);let resolveRequest,reads=0,clicked=0;
 const input={fill:async()=>{}},send={click:async()=>{clicked++;resolveRequest({method:()=>r.method,url:()=>r.url,postDataJSON:()=>r.body});}};
 const page={url:()=>s.origin+'/aidt/'+s.projectId+'?step=2&entity='+s.selector.entityId+'&thread='+s.threadId,getByTestId:key=>key==='copilotkit-v2-input'?input:key==='copilotkit-v2-send'?send:{count:async()=>0},waitForRequest:()=>new Promise(resolve=>{resolveRequest=resolve;})};
 const expect=()=>({toBeVisible:async()=>{},toHaveCount:async()=>{},toBeEnabled:async()=>{}});
 const read=async path=>{reads++;assert.ok(!path.includes('/agent-runs/'));return {status:200,data:path.includes('/messages?')?{messages:[human,agent],nextCursor:null}:{stage:{revision:2}}};};
 await assert.rejects(sendTeachingFeedback({page,expect,scope:s,read,armSend:()=>{}}),error=>{assert.equal(error.code,'TEACHING_HISTORY_NOT_CANONICAL');checkClosed(readTeachingHistoryFailureDiagnostic(error));return true;});assert.equal(clicked,1);assert.ok(reads>0);
});

function actualCheckpoint() {
 const source=readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs',import.meta.url),'utf8');
 const start=source.indexOf('    const checkpoint = async (name, operation) => {');
 const end=source.indexOf("    stage = 'ordinary-identity-and-home-entry';",start);
 assert.ok(start>0&&end>start);
 const report={checkpoints:[]},events=[],captures=[];
 const checkpoint=runInNewContext(source.slice(start,end)+'\ncheckpoint',{
  ProbeFailure,guard:{fatal:()=>null},report,performance,Date,
  console:{log:text=>events.push(JSON.parse(text))},recheckRuntime:()=>{},
  safeCode:error=>error.code,readTeachingHistoryFailureDiagnostic,
  capture:async name=>captures.push(name),
 });
 return {checkpoint,report,events,captures};
}
test('actual frozen checkpoint writes only safe diagnostic and preserves failure status/code',async()=>{
 const {checkpoint,report,events,captures}=actualCheckpoint();
 const error=failure({...scope(),knownMessages:[human]},[message(human,{id:human.clientMessageId})]);
 assert.equal(await checkpoint('teaching-chat-stage-2-revision',async()=>{throw error;}),false);
 const row=report.checkpoints[0];assert.equal(row.status,'failed');assert.equal(row.code,'TEACHING_HISTORY_NOT_CANONICAL');checkClosed(row.teachingHistoryDiagnostic);
 assert.deepEqual(captures,['teaching-chat-stage-2-revision-failed']);
 for(const output of [report,events])assert.ok(!JSON.stringify(output).includes('private-'));
});
test('actual frozen checkpoint discards malformed raw metadata rather than serializing it',async()=>{
 const {checkpoint,report,events}=actualCheckpoint();
 const error=attach({...valid(),rawWire:'private-forged-wire'});
 assert.equal(await checkpoint('teaching-chat-stage-2-revision',async()=>{throw error;}),false);
 assert.equal(report.checkpoints[0].status,'failed');assert.equal(report.checkpoints[0].code,'TEACHING_HISTORY_NOT_CANONICAL');
 assert.equal(Object.hasOwn(report.checkpoints[0],'teachingHistoryDiagnostic'),false);
 assert.ok(!JSON.stringify(report).includes('private-'));assert.ok(!JSON.stringify(events).includes('private-'));
});
