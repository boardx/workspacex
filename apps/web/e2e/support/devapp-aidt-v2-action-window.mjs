/** A finite normal UI action binds exact physical requests. Only named adjacent parallel groups may complete out of order; the independent guard still validates every body and reference. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const validId=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,119}$/.test(value);
export function createV2ActionWindow({guard,plan,runtimeScope,now=Date.now}) {
  let active=null;
  const sameScope=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const exactQuery=(step,url)=>step?.requestKind==='thread-mount' ? url.searchParams.get('projectId')===active?.scope.projectId&&[...url.searchParams.keys()].length===1&&[...url.searchParams.keys()].every(key=>key==='projectId') : !url.search;
  const key=request=>request.method+' '+new URL(request.url).pathname;
  function eligible(){if(!active)return [];const first=active.steps.findIndex(step=>!step.done);if(first<0)return [];const group=active.steps[first].parallelGroup;if(!group)return [active.steps[first]];const batch=[];for(const step of active.steps.slice(first)){if(step.parallelGroup!==group)break;if(!step.done)batch.push(step);}return batch;}
  function begin({actionId,steps,timeoutMs=30000}) {
    if(active||!validId(actionId)||!Array.isArray(steps)||!steps.length||steps.length>8||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>900000)fail('V2_UI_ACTION_WINDOW_INVALID');
    const scope=runtimeScope(),ids=new Set(),coordinates=new Set(),groups=new Set();let previousGroup=null;
    for(const step of steps){const op=plan.operations.find(row=>row.id===step.operationId);if(!op||ids.has(op.id)||!['POST','PUT'].includes(step.method)||typeof step.requestKind!=='string'||typeof step.path!=='string'||!step.path.startsWith('/api/')||/[?#\\]/.test(step.path)||step.path.includes('..')||step.path.includes('%')||op.stage!==step.stageId||op.entityRole!==step.entityRole||op.kind!==step.kind)fail('V2_UI_ACTION_STEP_NOT_CLOSED');ids.add(op.id);const coordinate=step.parallelGroup+' '+step.method+' '+step.path;if(step.parallelGroup&&coordinates.has(coordinate))fail('V2_UI_ACTION_DUPLICATE_COORDINATE');if(step.parallelGroup)coordinates.add(coordinate);if(step.parallelGroup){if(!validId(step.parallelGroup)||groups.has(step.parallelGroup)&&previousGroup!==step.parallelGroup||step.captureEntity||step.captureResource||step.captureThread)fail('V2_UI_ACTION_PARALLEL_GROUP_INVALID');groups.add(step.parallelGroup);}previousGroup=step.parallelGroup??null;}
    active={actionId,scope,steps:steps.map(step=>({...step,done:false})),index:0,pending:new Map(),deadline:now()+timeoutMs,receipts:[]};
    return {actionId,operationIds:[...ids]};
  }
  function armForRequest(request) {
    if(!active||request.method==='GET')return false;
    if(!sameScope(active.scope,runtimeScope())||now()>active.deadline)fail('V2_UI_ACTION_WINDOW_EXPIRED');
    let target;try{target=new URL(request.url);}catch{fail('V2_UI_ACTION_REQUEST_INVALID');}
    const options=eligible();if(options.some(step=>step.path.includes('{')))fail('V2_UI_ACTION_COORDINATE_NOT_BOUND');
    const step=options.find(step=>request.method===step.method&&target.pathname===step.path&&exactQuery(step,target));
    if(!step||active.pending.has(key(request))||target.hash||target.username||target.password)fail('V2_UI_ACTION_UNEXPECTED_PHYSICAL_WRITE');
    const op={operationId:step.operationId,kind:step.kind,requestKind:step.requestKind,stageId:step.stageId,entityRole:step.entityRole,...(step.entityId?{entityId:step.entityId}:{}),...(step.resourceId?{resourceId:step.resourceId}:{}),...(step.expectedFields?{expectedFields:step.expectedFields}:{})};
    guard.armV2Operation(op);if(step.requestKind==='stage-save')guard.armStageSave(step.stageId,step.expectedFields?.confirmation===true);if(step.requestKind==='design-create')guard.armDesignCreate({name:step.expectedFields?.name});if(step.requestKind==='design-generate')guard.armDesignGeneration({designId:step.resourceId});active.pending.set(key(request),{step,operationId:step.operationId,method:request.method,path:target.pathname});return true;
  }
  function observeResponse(request,status,response) {
    if(!active||request.method==='GET')return;
    const pending=active.pending.get(key(request));if(!pending)fail('V2_UI_ACTION_RESPONSE_NOT_ARMED');const step=pending.step;
    if(status<200||status>=300){guard.fail('V2_UI_ACTION_WRITE_FAILED_NO_REPLAY');fail('V2_UI_ACTION_WRITE_FAILED_NO_REPLAY');}
    const futureSteps=active.steps.filter(row=>!row.done&&row!==step);
    if(step.captureEntity){const capture=step.captureEntity,stage=response?.stage;if(stage?.projectId!==active.scope.projectId||stage.stageId!==step.stageId||!Array.isArray(capture.priorIds)||typeof capture.nameField!=='string'||typeof capture.expectedName!=='string'||(capture.collection!==undefined?(capture.collection!=='ideas'||step.stageId!==4||capture.prefix!==undefined):typeof capture.prefix!=='string'))fail('V2_UI_CREATED_ENTITY_RECEIPT_INVALID');const added=capture.collection==='ideas'?(Array.isArray(stage.content?.draft?.ideas)?stage.content.draft.ideas.filter(value=>typeof value?.id==='string'&&!capture.priorIds.includes(value.id)&&value[capture.nameField]===capture.expectedName):[]):Object.entries(stage.content?.draft?.fields??{}).filter(([key])=>key.startsWith(capture.prefix)).flatMap(([key,raw])=>{let value;try{value=JSON.parse(raw);}catch{return [];}return value?.id===key.slice(capture.prefix.length)&&!capture.priorIds.includes(value.id)&&value[capture.nameField]===capture.expectedName?[value]:[];});if(added.length!==1)fail('V2_UI_CREATED_ENTITY_RECEIPT_NOT_UNIQUE');guard.registerEntityRole(step.stageId,added[0].id,step.entityRole);for(const future of futureSteps){future.path=future.path.replace('{createdEntity}',encodeURIComponent(added[0].id));if(future.entityId==='{createdEntity}')future.entityId=added[0].id;}}
    if(step.captureResource){const capture=step.captureResource,idField=capture.idField??'id';if(!['id','interviewId'].includes(idField))fail('V2_UI_CREATED_RESOURCE_ID_FIELD_INVALID');if(capture.responsePath!==undefined&&capture.responsePath!=='project')fail('V2_UI_CREATED_RESOURCE_RESPONSE_PATH_INVALID');const resource=capture.responsePath==='project'?response?.project:response;const value=resource?.[idField];if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,256}$/.test(value)||resource?.[capture.nameField]!==capture.expectedName)fail('V2_UI_CREATED_RESOURCE_RECEIPT_INVALID');if(capture.asEntity)guard.registerEntityRole(step.stageId,value,step.entityRole);for(const future of futureSteps){future.path=future.path.replace('{createdResource}',encodeURIComponent(value));if(future.resourceId==='{createdResource}')future.resourceId=value;if(future.entityId==='{createdResource}')future.entityId=value;}}
    if(step.captureThread){const thread=response?.threadId??response?.thread?.id;if(typeof thread!=='string'||!/^thr[A-Za-z0-9_.:-]{1,250}$/.test(thread))fail('V2_UI_CREATED_THREAD_RECEIPT_INVALID');for(const future of futureSteps)future.path=future.path.replace('{createdThread}',encodeURIComponent(thread));}
    active.receipts.push({operationId:pending.operationId,method:pending.method,path:pending.path,status});active.pending.delete(key(request));step.done=true;active.index++;
  }
  function finish(actionId) {if(!active||active.actionId!==actionId||!sameScope(active.scope,runtimeScope())||now()>active.deadline||active.pending.size||active.index!==active.steps.length)fail('V2_UI_ACTION_NOT_COMPLETED');const result={actionId,physicalRequests:active.receipts.map(row=>({...row})),sameScope:true};active=null;return result;}
  function abort(code='V2_UI_ACTION_UNKNOWN_OUTCOME'){if(active?.pending.size)guard.fail(code);const actionId=active?.actionId;active=null;return {actionId,code};}
  const matchesNext=request=>{if(!active||request.method==='GET')return false;let url;try{url=new URL(request.url);}catch{return false;}return !active.pending.has(key(request))&&eligible().some(step=>request.method===step.method&&url.pathname===step.path&&exactQuery(step,url)&&!url.hash);};
  return Object.freeze({begin,matchesNext,armForRequest,observeResponse,finish,abort,active:()=>active?{actionId:active.actionId,index:active.index,total:active.steps.length,pending:active.pending.size>0}:null});
}
