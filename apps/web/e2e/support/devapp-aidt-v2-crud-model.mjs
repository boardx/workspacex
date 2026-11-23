/** Pure descriptions/readback for disposable CRUD fixtures. No browser or service calls. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const common={nameLabel:'卡片名称',editDialog:'修改卡片名称',saveName:'保存名称',deleteDialog:'删除卡片？'};
export const V2_CRUD_KINDS=Object.freeze(['problem','interview','observation','surprise','persona','hmw','brainstorm','idea','prototype','test']);
const specs={
  problem:{stageId:1,prefix:'problemEntity:',nameField:'title',directory:'aidt-problem-directory',createDialog:'新建问题',nameLabel:'问题名称',createButton:'创建问题',editDialog:'编辑问题',saveName:'保存修改',deleteDialog:'删除问题',editButton:n=>'编辑问题 '+n,deleteButton:n=>'删除问题 '+n},
  interview:{stageId:2,prefix:'interviewRecord:',nameField:'displayName',createDialog:'新建访谈',nameLabel:'受访者姓名或化名',createButton:'创建访谈',editDialog:'编辑访谈卡',saveName:'保存修改',deleteDialog:'删除访谈卡？'},
  observation:{stageId:2,prefix:'interviewRecord:',nameField:'displayName',createDialog:'新建观察',nameLabel:'观察对象或情境名称',createButton:'创建观察',editDialog:'编辑观察卡',saveName:'保存修改',deleteDialog:'删除观察卡？'},
  surprise:{...common,stageId:3,prefix:'definitionSurprise:',nameField:'observation',createDialog:'新建补充发现',chooseKind:'新建补充发现',createButton:'创建补充发现'},
  persona:{...common,stageId:3,prefix:'definitionPersona:',nameField:'name',createDialog:'新建画像',chooseKind:'新建画像',createButton:'创建画像'},
  hmw:{...common,stageId:3,prefix:'definitionHmw:',nameField:'text',createDialog:'新建HMW',chooseKind:'新建 HMW',createButton:'创建HMW'},
  brainstorm:{stageId:4,prefix:'ideaBrainstorm:',nameField:'title',directoryRole:'头脑风暴',createDialog:'新建头脑风暴',nameLabel:'场次名称',createButton:'开始头脑风暴',editDialog:'编辑头脑风暴',saveName:'保存名称',deleteDialog:'删除头脑风暴',editButton:n=>'编辑 '+n,deleteButton:n=>'删除 '+n},
  idea:{stageId:4,collection:'ideas',nameField:'title',directory:'aidt-idea-directory',createDialog:'新建点子',nameLabel:'点子名称',createButton:'保存点子',editDialog:'编辑点子',saveName:'保存点子',deleteDialog:'删除点子',editButton:n=>'编辑点子 '+n,deleteButton:n=>'删除点子 '+n},
  prototype:{stageId:5,prefix:'prototypeEntity:',nameField:'prototypeCardTitle',directory:'aidt-prototype-directory',createDialog:'新建原型',nameLabel:'原型名称',createButton:'创建原型',editDialog:'编辑原型',saveName:'保存修改',deleteDialog:'删除原型',editButton:n=>'编辑原型 '+n,deleteButton:n=>'删除原型 '+n},
  test:{stageId:6,prefix:'testGroup:',nameField:'name',directory:'aidt-test-group-directory',createDialog:'新建测试卡片',nameLabel:'测试名称',createButton:'创建测试卡片',editDialog:'编辑测试卡',saveName:'保存修改',deleteDialog:'删除测试卡？'},
};
export function v2CrudSpec(kind){if(!V2_CRUD_KINDS.includes(kind))fail('V2_CRUD_KIND_INVALID');return {...specs[kind],kind,role:'crud-'+kind};}
function json(value,code){try{return JSON.parse(value);}catch{fail(code);}}
export function v2CrudRows(stage,kind){
  const spec=v2CrudSpec(kind),draft=stage?.content?.draft;
  if(!stage)return [];
  if(stage.stageId!==spec.stageId||!draft?.fields||!Array.isArray(draft.ideas))fail('V2_CRUD_STAGE_INVALID');
  const rows=spec.collection?draft.ideas:Object.entries(draft.fields).filter(([key])=>key.startsWith(spec.prefix)).map(([key,raw])=>{
    const value=json(raw,'V2_CRUD_RECORD_INVALID'),id=key.slice(spec.prefix.length);
    if(!value||typeof value!=='object'||Array.isArray(value)||kind!=='prototype'&&value.id!==id)fail('V2_CRUD_RECORD_INVALID');
    return {...value,id};
  });
  const archivedIds=kind==='idea'?json(draft.fields.ideaArchivedIds??'[]','V2_CRUD_ARCHIVE_INVALID'):[];
  if(!Array.isArray(archivedIds))fail('V2_CRUD_ARCHIVE_INVALID');
  return rows.filter(row=>!['interview','observation'].includes(kind)||(row.kind??'interview')===kind).map(row=>({
    id:row.id,name:spec.stageId===3?(draft.fields['definitionCardName:'+row.id]||row[spec.nameField]):row[spec.nameField],
    archived:spec.stageId===2?draft.fields['interviewArchived:'+row.id]==='true':kind==='idea'?archivedIds.includes(row.id):kind==='prototype'?row.prototypeArchived==='true':row.archived===true,
    record:row,
  }));
}
export function assertV2CrudOwned(owned,projectId){
  const spec=v2CrudSpec(owned?.kind);
  if(!owned?.createdInThisRun||owned.projectId!==projectId||owned.stageId!==spec.stageId||owned.role!==spec.role
    ||typeof owned.entityId!=='string'||!owned.entityId||typeof owned.name!=='string'||!owned.name)fail('V2_CRUD_OWNED_SYNTHETIC_ENTITY_REQUIRED');
  return spec;
}
export function assertV2CrudRecord(stage,owned,{name=owned.name,archived=false}={}){
  assertV2CrudOwned(owned,stage?.projectId);
  const row=v2CrudRows(stage,owned.kind).find(value=>value.id===owned.entityId);
  if(!row||row.name!==name||row.archived!==archived)fail('V2_CRUD_RECORD_READBACK_MISMATCH');
  return row;
}
export function assertV2CrudSource(row,expected={}){
  for(const [key,value] of Object.entries(expected)){
    let actual=row.record[key];
    if(key==='prototypeIdeaSource')actual=json(actual,'V2_CRUD_CREATED_SOURCE_INVALID');
    if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(value)))fail('V2_CRUD_CREATED_SOURCE_MISMATCH');
  }
  return true;
}
export function v2CrudCreationSteps({kind,projectId,name,priorIds}){
  const spec=v2CrudSpec(kind),base=`/api/projects/${projectId}/aidt/stages/${spec.stageId}`,role=spec.role;
  if(!projectId||!name||!Array.isArray(priorIds))fail('V2_CRUD_CREATE_SCOPE_REQUIRED');
  const write=(suffix,requestKind,path,extra={})=>({operationId:`crud-${kind}-${suffix}`,kind:'write',requestKind,stageId:spec.stageId,entityRole:role,method:requestKind==='stage-save'||requestKind==='entity-thread'?'PUT':'POST',path,...extra});
  const entity=kind==='prototype'?'{createdResource}':'{createdEntity}';
  const first=kind==='prototype'?[
    write('create-design','design-create','/api/pm-designs',{expectedFields:{name},captureResource:{responsePath:'project',nameField:'name',expectedName:name,asEntity:true}}),
    write('link-design','design-link',`/api/projects/${projectId}/resources`,{resourceId:entity}),
    write('create','stage-save',base,{entityId:entity}),
  ]:[write('create','stage-save',base,{captureEntity:{...(spec.collection?{collection:spec.collection}:{prefix:spec.prefix}),nameField:spec.nameField,expectedName:['hmw','surprise'].includes(kind)?'':name,priorIds:[...priorIds]}})];
  return [...first,write('entity-thread-initial','entity-thread',base+'/entities/'+entity+'/thread',{entityId:entity,captureThread:true}),
    write('thread-mount','thread-mount','/api/threads/{createdThread}/skill-mounts',{entityId:entity}),
    ...(kind==='problem'?[write('initial-reconcile','reconcile-entity',base+'/entities/'+entity+'/reconcile',{entityId:entity})]:[])];
}
/** Protect all earlier entities, their frozen per-ID evidence and idea content. */
export function v2CrudProtectedSnapshot(stage,excludeIds=[]){
  if(!stage)return null;
  const fields=stage.content.draft.fields,ids=new Set(),excluded=new Set(excludeIds);
  for(const spec of Object.values(specs))if(spec.stageId===stage.stageId&&spec.prefix)for(const key of Object.keys(fields))if(key.startsWith(spec.prefix))ids.add(key.slice(spec.prefix.length));
  for(const idea of stage.content.draft.ideas)ids.add(idea.id);
  const primaryKeys=stage.stageId===3?new Set(['definitionPrimaryEntity','surpriseStatus','surpriseConfirmed','priorBelief','surprisingFinding','surpriseSourceDetails','surpriseInterpretation','surpriseCardIds','surpriseSourceRevision']):new Set();
  return {projectId:stage.projectId,stageId:stage.stageId,fields:Object.fromEntries(Object.entries(fields).filter(([key])=>primaryKeys.has(key)||[...ids].some(id=>!excluded.has(id)&&key.includes(id))).sort(([a],[b])=>a.localeCompare(b))),
    ideas:stage.content.draft.ideas.filter(row=>!excluded.has(row.id))};
}
export function assertV2CrudProtected(before,after,ownedId){
  if(!before)return true;
  // Only prior IDs are relevant; the newly owned fixture is deliberately excluded.
  const original=v2CrudProtectedSnapshot(before,[ownedId]),current=v2CrudProtectedSnapshot(after,[ownedId]);
  const keys=Object.keys(original.fields),filtered={...current,fields:Object.fromEntries(keys.map(key=>[key,current.fields[key]]))};
  if(JSON.stringify(original)!==JSON.stringify(filtered))fail('V2_CRUD_MODIFIED_EXISTING_ENTITY');
  return true;
}
