import test from 'node:test';
import assert from 'node:assert/strict';
import { V2_CRUD_KINDS,v2CrudSpec,v2CrudRows,assertV2CrudOwned,assertV2CrudRecord,assertV2CrudSource,v2CrudCreationSteps,assertV2CrudProtected } from './devapp-aidt-v2-crud-model.mjs';
import { createV2VoicePlan } from './devapp-aidt-v2-plan.mjs';
const project='prj-synthetic-unit',own='qa-disposable',main='qa-main';
const stage=(stageId,fields={},ideas=[])=>({projectId:project,stageId,revision:1,content:{draft:{fields,ideas,selectedIdeaId:''}}});
const owned=kind=>({kind,stageId:v2CrudSpec(kind).stageId,role:'crud-'+kind,projectId:project,entityId:own,name:'QA disposable',createdInThisRun:true});
function fixture(kind){
  const s=v2CrudSpec(kind),record={id:own,[s.nameField]:'QA disposable',archived:false};
  const fields=s.collection?{}:{[s.prefix+own]:JSON.stringify(record)};
  if(kind==='observation')record.kind='observation';
  if(kind==='observation')fields[s.prefix+own]=JSON.stringify(record);
  if(s.stageId===3)fields['definitionCardName:'+own]='QA disposable';
  return stage(s.stageId,fields,s.collection?[record]:[]);
}

test('enumerates exactly the ten actual creatable kinds, not reports or read-only cards',()=>{
  assert.deepEqual(V2_CRUD_KINDS,['problem','interview','observation','surprise','persona','hmw','brainstorm','idea','prototype','test']);
  assert.throws(()=>v2CrudSpec('group-report'),/V2_CRUD_KIND_INVALID/);
});
for(const kind of V2_CRUD_KINDS){
  test(`${kind}: creation only uses declared, unique named operations at the correct role and stage`,()=>{
    const s=v2CrudSpec(kind),plan=createV2VoicePlan(),steps=v2CrudCreationSteps({kind,projectId:project,name:'QA disposable',priorIds:[main]});
    assert.equal(new Set(steps.map(row=>row.operationId)).size,steps.length);
    for(const step of steps){const slot=plan.operations.find(row=>row.id===step.operationId);assert.ok(slot,step.operationId);assert.equal(slot.entityRole,s.role);assert.equal(slot.stage,s.stageId);assert.equal(step.entityRole,s.role);assert.equal(step.stageId,s.stageId);}
    assert.ok(steps.some(row=>row.operationId===`crud-${kind}-create`&&row.requestKind==='stage-save'));
    assert.ok(steps.some(row=>row.operationId===`crud-${kind}-entity-thread-initial`&&row.captureThread===true));
    assert.ok(steps.some(row=>row.requestKind==='thread-mount'&&row.path.includes('{createdThread}')));
    if(kind==='prototype')assert.deepEqual(steps.slice(0,3).map(row=>row.requestKind),['design-create','design-link','stage-save']);
    else if(kind==='idea')assert.equal(steps[0].captureEntity.collection,'ideas');
    else assert.equal(steps[0].captureEntity.prefix,s.prefix);
  });
  test(`${kind}: exact owned record survives archive, and a same-name foreign entity cannot replace it`,()=>{
    const value=fixture(kind),o=owned(kind);assert.equal(assertV2CrudRecord(value,o).id,own);
    assert.throws(()=>assertV2CrudRecord({...value,projectId:'foreign'},o),/V2_CRUD_OWNED_SYNTHETIC_ENTITY_REQUIRED/);
    assert.throws(()=>assertV2CrudRecord(value,{...o,entityId:'not-created-here'}),/V2_CRUD_RECORD_READBACK_MISMATCH/);
    assert.throws(()=>assertV2CrudOwned({...o,createdInThisRun:false},project),/V2_CRUD_OWNED_SYNTHETIC_ENTITY_REQUIRED/);
    const s=v2CrudSpec(kind),fields=value.content.draft.fields;
    if(s.stageId===2)fields['interviewArchived:'+own]='true';
    else if(kind==='idea')fields.ideaArchivedIds=JSON.stringify([own]);
    else{const record=JSON.parse(fields[s.prefix+own]);if(kind==='prototype')record.prototypeArchived='true';else record.archived=true;fields[s.prefix+own]=JSON.stringify(record);}
    assert.equal(assertV2CrudRecord(value,o,{archived:true}).archived,true);
    assert.equal(v2CrudRows(value,kind).length,1,'archive must retain history, never remove its record');
  });
}
test('interview and observation are distinct business kinds within the shared record namespace',()=>{
  const a=fixture('interview'),b=fixture('observation');
  a.content.draft.fields['interviewRecord:other']=JSON.stringify({...JSON.parse(b.content.draft.fields['interviewRecord:'+own]),id:'other'});
  assert.deepEqual(v2CrudRows(a,'interview').map(row=>row.id),[own]);assert.deepEqual(v2CrudRows(a,'observation').map(row=>row.id),['other']);
});
test('S3 captures the actual empty new business fields, but verifies the separate visible card name',()=>{
  for(const kind of ['surprise','hmw']){const s=v2CrudSpec(kind),st=fixture(kind),r=JSON.parse(st.content.draft.fields[s.prefix+own]);r[s.nameField]='';st.content.draft.fields[s.prefix+own]=JSON.stringify(r);assert.equal(assertV2CrudRecord(st,owned(kind)).name,'QA disposable');assert.equal(v2CrudCreationSteps({kind,projectId:project,name:'QA disposable',priorIds:[]})[0].captureEntity.expectedName,'');}
});
test('protects pre-existing entity records, per-ID frozen evidence and main idea text while allowing its owned fixture to change',()=>{
  const before=stage(4,{['ideaBrainstorm:'+main]:JSON.stringify({id:main,title:'Main',source:{id:'hmw',revision:2}}),['ideaBrainstormRoundCompletion:'+main]:'frozen-main'},[{id:main,title:'main idea',description:'keep'},{id:own,title:'QA disposable',description:''}]);
  const after=structuredClone(before);after.revision=2;after.content.draft.ideas[1].title='owned renamed';after.content.draft.fields.ideaArchivedIds=JSON.stringify([own]);assert.equal(assertV2CrudProtected(before,after,own),true);
  after.content.draft.ideas[0].description='tampered';assert.throws(()=>assertV2CrudProtected(before,after,own),/V2_CRUD_MODIFIED_EXISTING_ENTITY/);
  after.content.draft.ideas[0].description='keep';after.content.draft.fields['ideaBrainstormRoundCompletion:'+main]='changed';assert.throws(()=>assertV2CrudProtected(before,after,own),/V2_CRUD_MODIFIED_EXISTING_ENTITY/);
});
test('rejects damaged entity records instead of silently treating them as an empty directory',()=>{
  assert.throws(()=>v2CrudRows(stage(1,{['problemEntity:'+own]:'{bad'}),'problem'),/V2_CRUD_RECORD_INVALID/);
  assert.throws(()=>v2CrudRows(stage(1,{['problemEntity:'+own]:JSON.stringify({id:'other',title:'same'})}),'problem'),/V2_CRUD_RECORD_INVALID/);
  assert.throws(()=>v2CrudRows(stage(2),'problem'),/V2_CRUD_STAGE_INVALID/);
});
test('checks exact immutable source IDs/versions semantically, not by JSON object key order',()=>{
  const row={record:{prototypeIdeaSource:JSON.stringify({revision:17,brainstormId:'round-a',ideaIds:['idea-a']})}};
  assert.equal(assertV2CrudSource(row,{prototypeIdeaSource:{ideaIds:['idea-a'],revision:17,brainstormId:'round-a'}}),true);
  assert.throws(()=>assertV2CrudSource(row,{prototypeIdeaSource:{revision:18,brainstormId:'round-a',ideaIds:['idea-a']}}),/V2_CRUD_CREATED_SOURCE_MISMATCH/);
  assert.throws(()=>assertV2CrudSource(row,{prototypeIdeaSource:{revision:17,brainstormId:'round-b',ideaIds:['idea-a']}}),/V2_CRUD_CREATED_SOURCE_MISMATCH/);
  assert.throws(()=>assertV2CrudSource({record:{...row.record,prototypeIdeaSource:'{broken'}},{prototypeIdeaSource:{revision:17}}),/V2_CRUD_CREATED_SOURCE_INVALID/);
});
test('checks S2 problem and S6 prototype bindings before treating a new card as created',()=>{
  const row={record:{problemEntityId:'problem-a',topicRevision:7,designId:'design-a',versionId:'v2',stage5Revision:42,researchPath:'offline'}};
  assert.equal(assertV2CrudSource(row,{problemEntityId:'problem-a',topicRevision:7}),true);
  assert.equal(assertV2CrudSource(row,{designId:'design-a',versionId:'v2',stage5Revision:42,researchPath:'offline'}),true);
  assert.throws(()=>assertV2CrudSource(row,{stage5Revision:43}),/V2_CRUD_CREATED_SOURCE_MISMATCH/);
});
test('early supplementary CRUD cannot rewrite the main primary surprise stored in legacy top-level fields',()=>{
  const before=stage(3,{definitionPrimaryEntity:'true',surpriseStatus:'found',surpriseConfirmed:'true',surprisingFinding:'Only this saved synthetic difference',surpriseCardIds:'["source-a"]'});
  const after=structuredClone(before);after.content.draft.fields['definitionSurprise:'+own]=JSON.stringify({id:own,archived:true,observation:''});
  assert.equal(assertV2CrudProtected(before,after,own),true);
  after.content.draft.fields.surprisingFinding='silently overwritten';
  assert.throws(()=>assertV2CrudProtected(before,after,own),/V2_CRUD_MODIFIED_EXISTING_ENTITY/);
});
