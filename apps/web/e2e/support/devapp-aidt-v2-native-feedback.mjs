/** Observe a real product candidate button's native Chat send. Never fabricates its prompt, reply or scope. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { validateTeachingWire, identifyOwnedTeachingRun, validateTeachingEvidence } from './devapp-aidt-chat-evidence.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const nativeOperations=new Map([
  ['s1-problem-main-problem-candidate','problem'],['s1-problem-main-candidate-cancel','problem'],
  ['s2-source-interview-finding-candidate','interview'],['s2-source-observation-finding-candidate','interview'],['s2-source-interview-candidate-cancel','interview'],
  ...['persona','hmw'].flatMap(kind=>['single-candidate-preview-cancel','multiple-candidates-select'].map(suffix=>[`s3-${kind}-main-${suffix}`,kind])),
  ['s4-method-free-candidate','ideation'],['s4-method-free-candidate-cancel','ideation'],
  ['s5-prototype-single-text-candidate','prototype'],['s5-prototype-three-text-candidate','prototype'],['s5-prototype-three-candidate-cancel','prototype'],
  ...['offline','survey','virtual'].flatMap(path=>['plan','result'].map(phase=>[`s6-test-${path}-${phase}-candidate`,'test'])),['s6-test-offline-plan-candidate-cancel','test'],
]);
export const v2NativeActionKind=operationId=>nativeOperations.get(operationId)??null;
/** Matches the product's coordinates-only selector from authorized server heads before any candidate/native send. */
export async function prepareV2NativeExpected({read,guard,projectId,stageId,rawUrl}) {
  const url=new URL(rawUrl),entityId=url.searchParams.get('entity')??undefined,threadId=url.searchParams.get('thread');
  if(url.pathname!==`/aidt/${projectId}`||url.searchParams.get('step')!==String(stageId)||!threadId?.startsWith('thr')||url.searchParams.has('entityRevision')||url.searchParams.has('history'))fail('V2_NATIVE_PREOBSERVED_UI_THREAD_REQUIRED');
  const stages={};for(let n=1;n<=stageId;n++){const got=await read(`/api/projects/${projectId}/aidt/stages/${n}`);if(got.status!==200)fail('V2_NATIVE_SOURCE_READ_FAILED');const row=got.data?.stage;if(row){if(row.projectId!==projectId||row.stageId!==n||!Number.isSafeInteger(row.revision))fail('V2_NATIVE_SOURCE_SCOPE_CHANGED');stages[n]=row;}}
  let selector={schemaVersion:1,projectId,purpose:'stage',stageId,...(entityId?{entityId}:{}),stageRevisions:[]};
  if(entityId){if(stages[stageId])selector.stageRevisions.push({stageId,revision:stages[stageId].revision});if(stageId===2){let record;try{record=JSON.parse(stages[2]?.content?.draft?.fields?.['interviewRecord:'+entityId]??'null');}catch{}if(record?.id!==entityId)fail('V2_NATIVE_INTERVIEW_SOURCE_REQUIRED');if(record.problemEntityId&&Number.isSafeInteger(record.topicRevision)){selector.sourceEntityId=record.problemEntityId;selector.stageRevisions.unshift({stageId:1,revision:record.topicRevision});}}}
  else{const refs=new Map(Object.values(stages).map(row=>[row.stageId,row.revision]));for(const ref of stages[stageId]?.sourceStageRevisions??[])refs.set(ref.stageId,ref.revision);selector.stageRevisions=[...refs].sort(([a],[b])=>a-b).map(([stageId,revision])=>({stageId,revision}));const previous=url.searchParams.get('returnRevision');if(previous){if(!/^[1-9]\d*$/.test(previous))fail('V2_NATIVE_RETURN_REVISION_INVALID');selector.returnRevision=Number(previous);}}
  const detail=await read(`/api/chat/threads/${encodeURIComponent(threadId)}?projectId=${encodeURIComponent(projectId)}`),mounts=await read(`/api/threads/${encodeURIComponent(threadId)}/skill-deviations?projectId=${encodeURIComponent(projectId)}`);
  if(detail.status!==200||mounts.status!==200)fail('V2_NATIVE_OWNED_THREAD_AND_PIN_READ_REQUIRED');const pin=guard.teachingPin(stageId,threadId,entityId);if(!pin)fail('V2_NATIVE_CANONICAL_SKILL_PIN_REQUIRED');
  const messages=await read(`/api/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`),body=messages.data,knownMessages=Array.isArray(body)?body:body?.messages??body?.items;
  if(messages.status!==200||!Array.isArray(knownMessages)||knownMessages.length>100||!Array.isArray(body)&&body.nextCursor!=null)fail('V2_NATIVE_CANONICAL_MESSAGES_REQUIRED');
  return {...pin,selector,threadId,knownMessages,...(entityId?{entityId}:{})};
}
export function createV2NativeActionObserver({page,expect,read,guard,plan,report,runtimeScope,assertSafe,capture,candidateActions}) {
  return async ({stageId,operationId,perform})=>{
    const op=plan.operations.find(row=>row.id===operationId);
    const kind=v2NativeActionKind(operationId),prefix=candidateActions?.[kind];
    if(!op||op.kind!=='teaching'||op.stage!==stageId||!prefix||typeof perform!=='function')fail('V2_CANDIDATE_OPERATION_NOT_CLOSED');
    const before=await read(`/api/projects/${runtimeScope().projectId}/aidt/stages/${stageId}`);
    if(before.status!==200)fail('V2_CANDIDATE_SOURCE_READ_FAILED');
    const url=new URL(page.url());
    if(url.pathname!==`/aidt/${runtimeScope().projectId}`||url.searchParams.get('step')!==String(stageId))fail('V2_CANDIDATE_UI_SCOPE_CHANGED');
    const expected=await prepareV2NativeExpected({read,guard,projectId:runtimeScope().projectId,stageId,rawUrl:page.url()});
    guard.armV2Operation({operationId,kind:'teaching',requestKind:'teaching-send',stageId,entityRole:op.entityRole,
      ...(url.searchParams.get('entity')?{entityId:url.searchParams.get('entity')}:{}),expectedFields:{nativeActionPrefix:prefix,selector:expected.selector,threadId:expected.threadId,skillId:expected.skillId,skillVersionId:expected.skillVersionId,knownMessages:expected.knownMessages}});
    let request;
    try{[request]=await Promise.all([page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname==='/api/copilotkit/agent/default/run',{timeout:60000}),perform()]);}
    catch{fail('V2_CANDIDATE_SEND_UNKNOWN_STOP');}
    const state=guard.nativeTeachingState(operationId);
    if(!state?.scope||!state.wire)fail('V2_CANDIDATE_REAL_WIRE_NOT_BOUND');
    const wire=validateTeachingWire({method:request.method(),url:request.url(),body:request.postDataJSON()},state.scope);
    if(JSON.stringify(wire)!==JSON.stringify(state.wire))fail('V2_CANDIDATE_WIRE_CHANGED');
    let proof,terminal;
    const messagePath=`/api/chat/threads/${encodeURIComponent(state.scope.threadId)}/messages?limit=100`;
    await expect.poll(async()=>{
      if(terminal)return true;
      try{
        const messages=await read(messagePath);if(messages.status!==200)fail('V2_CANDIDATE_CANONICAL_MESSAGES_UNAVAILABLE');
        const accepted=identifyOwnedTeachingRun(messages.data,state.scope,wire);if(!accepted)return false;
        const current=await read(`/api/agent-runs/${encodeURIComponent(accepted.runId)}`);
        if(current.status!==200)fail('V2_CANDIDATE_RUN_UNAVAILABLE');
        if(current.data.status==='awaiting_tool_permission')fail('V2_CANDIDATE_TOOL_REVIEW_REQUIRED');
        if(['failed','cancelled','paused'].includes(current.data.status))fail('V2_CANDIDATE_NATIVE_RUN_FAILED');
        if(current.data.status!=='succeeded')return false;
        const receipt=await read(`/api/agent-runs/${encodeURIComponent(accepted.runId)}/aidt-context`);
        if(receipt.status!==200)fail('V2_CANDIDATE_CONTEXT_RECEIPT_UNAVAILABLE');
        proof=validateTeachingEvidence({messages:messages.data,run:current.data,receipt:receipt.data},state.scope,wire,accepted,state.snapshotHash);
        return true;
      }catch(error){if(error instanceof ProbeFailure){terminal=error;return true;}throw error;}
    },{timeout:180000,intervals:[500,1000,2000]}).toBe(true);
    if(terminal)throw terminal;
    const after=await read(`/api/projects/${runtimeScope().projectId}/aidt/stages/${stageId}`);
    if(after.status!==200||JSON.stringify(before.data)!==JSON.stringify(after.data))fail('V2_CANDIDATE_AUTOSAVED_SHARED_STAGE');
    assertSafe(proof.assistantText);guard.completeTeaching(proof);
    report.teachingEvidence.push({...proof,projectId:state.scope.projectId,entityId:state.scope.selector.entityId??null,checkpoint:operationId,prompt:state.scope.prompt,status:'passed',source:runtimeScope().source,tag:runtimeScope().tag,autoSaved:false});
    await capture('v2-'+operationId+'-real-reply',stageId,stageId===3&&['persona','hmw'].includes(kind)?'candidate-dialog':'workspace');
    return proof;
  };
}
