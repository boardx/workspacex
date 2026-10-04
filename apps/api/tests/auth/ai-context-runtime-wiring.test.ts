import {describe,it,expect,vi} from "vitest";
import {readContextPackAiFacts,aiContextInputHash} from "../../src/application/agent-run/context-pack-ai-facts";
import {createAiQuotaRuntimeWiring} from "../../src/infrastructure/agent-run/ai-runtime-wiring";
import {assembleFromRecorded} from "../../src/application/context-pack/replay-pack";
import {packContentHash} from "../../src/domain/context-pack/pack-hash";
import type {RecordedRun} from "../../src/domain/context-pack/recorded-run";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("facts-org"),input={orgId:org,userId:"u",runId:"agent-run",serializedInput:"exact trusted assembled input"};
const run:RecordedRun={runId:"context-run",packId:"pack",orgId:String(org),query:{tenantId:String(org),principalId:"u",projectIds:[],task:"decision-support",query:"fixture",timeRange:null,allowedSensitivity:["internal"],tokenBudget:1000,freshnessRequirement:null,evidencePolicy:"all"},retrievalPlan:[],candidates:[],withheld:[],unanchorable:[],claims:[],thresholdUsed:0.45};
function fixture(){
 const row={run,contentHash:packContentHash(assembleFromRecorded(run,null)),pinnedSnapshotId:null};
 const store={findRecorded:vi.fn().mockResolvedValue(row),confidentialNow:vi.fn().mockResolvedValue(new Set())};
 const bindings={resolve:vi.fn().mockResolvedValue({contextPackRunId:run.runId,inputSha256:aiContextInputHash(input.serializedInput),completeInput:true,requiredCapabilities:["tools"]})};
 const constraints={resolve:vi.fn().mockResolvedValue({localOnly:false,source:"org-policy",reason:"fixture"})};
 return {store,bindings,constraints};
}
describe("trusted Context Pack facts and default-off runtime composition",()=>{
 it("default-off never builds registrations or queries; enabling absent config fails closed",()=>{
  const deps={} as never;expect(createAiQuotaRuntimeWiring(false,null,deps)).toBeNull();
  expect(()=>createAiQuotaRuntimeWiring(true,null,deps)).toThrow("AI_RUNTIME_REQUIRED_CONFIGURATION_MISSING");
 });
 it("binds exact complete input to the original principal, replay and identity authority",async()=>{
  const f=fixture();expect(await readContextPackAiFacts(input,f as never)).toEqual({confidentiality:"unknown",requiredCapabilities:[]});
  expect(f.bindings.resolve).toHaveBeenCalledWith(org,"u","agent-run",aiContextInputHash(input.serializedInput));
  expect(f.constraints.resolve).toHaveBeenCalledWith({orgId:org,userId:"u",dataScope:[]});
  f.constraints.resolve.mockResolvedValue({localOnly:true,source:"org-policy",reason:"strict"});
  expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"unknown"});
 });
 it("missing/partial/mismatched bindings and foreign principal/tenant remain unknown",async()=>{
  for(const binding of [null,{completeInput:false,inputSha256:aiContextInputHash(input.serializedInput)},{completeInput:true,inputSha256:"wrong"}]){
   const f=fixture();f.bindings.resolve.mockResolvedValue(binding);expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"unknown"});expect(f.constraints.resolve).not.toHaveBeenCalled();
  }
  for(const altered of [{...run,orgId:"other"},{...run,query:{...run.query,principalId:"other"}}]){
   const f=fixture();f.store.findRecorded.mockResolvedValue({run:altered,contentHash:"irrelevant",pinnedSnapshotId:null});expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"unknown"});expect(f.constraints.resolve).not.toHaveBeenCalled();
  }
 });
 it("a divergent recorded pack cannot silently classify the current request as public",async()=>{
  const f=fixture();f.store.findRecorded.mockResolvedValue({run,contentHash:"tampered",pinnedSnapshotId:null});await expect(readContextPackAiFacts(input,f as never)).rejects.toThrow();expect(f.constraints.resolve).not.toHaveBeenCalled();
 });
});

import * as whole from '../../src/application/agent-run/whole-input-binding-producer';
import {pricedRunModel} from '../../src/application/agent-run/priced-run-model';
import {withRunLease} from '../../src/application/agent-run/run-lease';
import {PgRuntimeModelUsageRepository} from '../../src/infrastructure/auth/pg-runtime-model-usage-repository';
import {createHash} from 'node:crypto';
it('raw envelope covers duplicate keys/extra fields and cannot accept public or actor flags',async()=>{
 const subject={orgId:org,userId:'u',rootRunId:'root',runId:'child',attemptId:'child:1',leaseEpoch:2,origin:'private-sdk-body' as const};
 const body='{"messages":[{"content":"private-secret"}],"actor":"foreign","completeInput":true,"classification":"public","messages":[],"extra":"secret-tool"}';
 const manifest=whole.produceWholeInputBinding(subject,body);
 expect(manifest.components[0]?.sha256).toBe(aiContextInputHash(body));expect(manifest.components.every(c=>c.classification==='unknown')).toBe(true);
 expect(JSON.stringify(manifest)).not.toMatch(/private-secret|secret-tool|messages/);expect(Object.isFrozen(manifest.subject)&&Object.isFrozen(manifest.components)).toBe(true);
 expect(whole.matchesWholeInputBinding(manifest,subject,body)).toBe(true);
 for(const altered of [{orgId:toOrgId('foreign'),userId:'u',runId:'child'},{orgId:org,userId:'foreign',runId:'child'},{orgId:org,userId:'u',runId:'root'}])expect(whole.matchesWholeInputBinding(manifest,{...subject,...altered},body)).toBe(false);
 expect(whole.matchesWholeInputBinding(manifest,subject,body+' ')).toBe(false);
 for(const altered of [{attemptId:'child:2'},{leaseEpoch:3},{rootRunId:'foreign-root'},{origin:'root-model-input' as const}])expect(whole.matchesWholeInputBinding(manifest,{...subject,...altered},body)).toBe(false);
 const f=fixture();f.bindings.resolve.mockResolvedValue(manifest as never);
 expect(await readContextPackAiFacts({...input,runId:'child',serializedInput:body},f as never)).toMatchObject({confidentiality:'unknown'});
 f.bindings.resolve.mockResolvedValue({...manifest,components:[]} as never);expect(await readContextPackAiFacts({...input,runId:'child',serializedInput:body},f as never)).toMatchObject({confidentiality:'unknown'});
});
function wholeFixture(child=false,contextBindings?:import("../../src/application/agent-run/context-pack-ai-facts").AiContextPackBindingPort,recordedRow?:ReturnType<typeof selectedFixture>["row"],outsideReject=false){
 const config={window:{start:'2026-10-01T00:00:00Z',end:'2026-11-01T00:00:00Z',timezone:'Etc/UTC'},ordinaryTokensPerUser:'100',costMicrosPerUser:'100',currency:'CNY',prices:[{modelId:'formal',modelProvider:'route',runtimeModelId:'actual',inputMicrosPerMillion:'1',outputMicrosPerMillion:'1',cachedInputMicrosPerMillion:'1',maxInputTokens:10,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1};
 const owner={user_id:'u',root_run_id:'root',subtask_id:child?'child':null,project_id:null,thread_id:'thread',agent_id:'agent'};
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('FROM context_packs'))return {rows:recordedRow?[{run_id:'context-run',org_id:String(org),status:'assembled',recorded:recordedRow.run,content_hash:recordedRow.contentHash,threshold_used:recordedRow.run.thresholdUsed,pinned_snapshot_id:null}]:[]};
  if(sql.includes('FROM segment_text'))return {rows:[]};
  if(sql.includes('SELECT v.instructions'))return {rows:[{instructions:'pinned parent instructions'}]};
  if(sql.includes('SELECT * FROM subtask_runs'))return {rows:child?[{id:'child',parent_run_id:'root',description:'child raw description',context:'child source context',status:'running',agent_version_id:'version',skill_version_ids:[],model_provider:'route',model_id:'actual',artifact_refs:[],tool_calls:[],result:null,error:null,created_at:new Date(0),updated_at:new Date(0),cancel_requested_at:null,cancellation_state:null}]:[]};
  if(sql.includes('FROM agent_runs'))return {rows:child?[]:[owner]};if(sql.includes('FROM subtask_runs'))return {rows:child?[owner]:[]};
  if(sql.includes('FROM organizations'))return {rows:[{id:org,name:'formal',kind:'organization',model_policy:'any',avatar_artifact_id:null}]};if(sql.includes('FROM org_memberships'))return {rows:[{member:1,org_role:'consultant',team_id:null}]};
  if(sql.includes('FROM organization_plans'))return {rows:[{plan:'ordinary'}]};if(sql.includes('FROM organization_ai_policies'))return {rows:[{configuration:config,price_version:'price',updated_by:'u'}]};if(sql.includes(' AS active'))return {rows:[{active:true}]};return {rows:[]};
 });
 const db={withTenant:async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query});}};
 let vendors=0;
 const model={supportsRequestAccounting:()=>true,supportsDispatchAdmission:()=>true,complete:vi.fn(async(call:import('../../src/application/agent-run/ports').ModelCallInput)=>{
  const serializedBody=JSON.stringify({model:call.modelId,messages:[{role:'system',content:call.system},{role:'user',content:call.user}]});
  await call.beforeProviderDispatch!({requestId:'physical',modelProvider:'route',modelId:'actual',serializedBody,outputTokenLimit:10});vendors++;return {text:'paid'};
 })};
 const registration={billingUnit:'token' as const,implementation:'fixture-proof',version:'1',artifactSha256:'a'.repeat(64),source:'verified-upper-bound' as const,verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>2,binding:{modelId:'formal',modelProvider:'route',runtimeModelId:'actual',contextWindow:100,maxOutputTokens:10,capabilityTags:[],outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}};
 const pool={listForOrg:async()=>[{row:{modelId:'formal',kind:'closed-api',shape:'single',status:'已启用',contextWindow:100,capabilityTags:[],complianceAttrs:[],members:[]}}]};
 const usage={startRequest:vi.fn(),record:vi.fn()};const wiring=createAiQuotaRuntimeWiring(true,{modelBounds:[registration],contextBindings,privateRuntimeProvider:'route',selection:async()=>{}},{db:outsideReject?{withTenant:async()=>{throw new Error('escaped outside pool');}}:db,identity:{findOrgMembership:async()=>{throw new Error('escaped outside identity');},findOrganization:async()=>{throw new Error('escaped outside identity');}},pool:outsideReject?{listForOrg:async()=>{throw new Error('escaped outside model pool');}}:pool,model,usage} as never)!;
 return {wiring,db,model,usage,query,get vendors(){return vendors;}};
}
it('actual root priced boundary sends assembled fields to producer; unknown is zero reservation/vendor',async()=>{
 const f=wholeFixture(),spy=vi.spyOn(whole,'produceWholeInputBinding');try{
  const claimed={runId:'root',requesterUserId:'u',modelProvider:'route',modelId:'actual',resumeStepSeqBase:1,permissionRequestId:null,projectId:null,threadId:'thread',agentId:'agent'};
  const assembled={orgId:String(org),runId:'root',modelProvider:'route',modelId:'actual',executionAttemptId:'root:1',executionLeaseEpoch:1,system:'agent+skill+protocol',user:'raw+attachment+notice',history:[{role:'user',content:'summary+KG+tool'}],skills:[{versionId:'skill',stableName:'skill',content:'pinned'}],images:[{mime:'image/png',dataBase64:'private-pixel'}],interjection:{extra:'private'},extra:'unknown'};
  const model=pricedRunModel(f.model,org,claimed as never,f.wiring.run);
  await expect(withRunLease({orgId:org,runId:'root',epoch:1,verify:async()=>{}},()=>model.complete(assembled as never))).rejects.toThrow('AI_MODEL_UNAVAILABLE');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({runId:'root',attemptId:'root:1',leaseEpoch:1,origin:'root-model-input'}),JSON.stringify(assembled),null,null,undefined);expect(f.vendors).toBe(0);expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO ai_request_reservations'))).toBe(false);
 }finally{spy.mockRestore();}
});
for(const child of [false,true])it(`private ${child?'child':'root'} admission sends SDK body and own identity to producer; unknown rejects`,async()=>{
 const f=wholeFixture(child),spy=vi.spyOn(whole,'produceWholeInputBinding'),runId=child?'child':'root';try{
  const repo=new PgRuntimeModelUsageRepository(f.db as never,f.usage as never,undefined,f.wiring.runtime);
  const serializedBody='{"model":"actual","max_tokens":5,"messages":[{"content":"raw-private"}],"tools":[{"name":"private-tool"}],"completeInput":true,"classification":"public"}';
  const request={requestId:'ad05ca76-9ff5-459b-955f-73634b36ec23',attemptId:runId+':1',leaseEpoch:1,startedAt:new Date().toISOString(),modelId:'actual',callPurpose:'primary' as const,serializedBody,outputTokenLimit:5,logicalCallId:JSON.stringify([runId,'primary',createHash('sha256').update(serializedBody).digest('hex')])};
  await expect(repo.admitRuntimeRequest(org,runId,request)).rejects.toThrow('AI_MODEL_UNAVAILABLE');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({rootRunId:'root',runId,attemptId:runId+':1',leaseEpoch:1,origin:'private-sdk-body'}),serializedBody,null,undefined,child?expect.any(Object):null);expect(f.vendors).toBe(0);expect(f.query.mock.calls.some(([sql])=>/INSERT INTO (ai_request_reservations|model_request_starts)/.test(sql))).toBe(false);
 }finally{spy.mockRestore();}
});

import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {bindRootAssembly,readRootAssembly,inheritRootAssembly} from '../../src/application/agent-run/root-input-source-provenance';
import {executeQueuedRuns} from '../../src/application/agent-run/execute-run';
it('real executeQueuedRuns assembler reaches the wired producer with pinned system/history/attachment user',async()=>{
 const f=wholeFixture(),spy=vi.spyOn(whole,'produceWholeInputBinding');try{
  const claimed={runId:'root',threadId:'thread',projectId:null,inputMessageId:'message',requesterUserId:'u',inputText:'Please compare previous source',inputAttachments:[{attachmentId:'current-attachment',filename:'private.txt',mime:'text/plain'}],agentId:'agent',agentVersionId:'version',instructions:'pinned instructions',skillVersionIds:['skill-version'],modelProvider:'route',modelId:'actual',pendingDecision:null,leaseEpoch:1};
  const sourceQuery=vi.fn(async(sql:string)=>({rows:sql.includes('FROM skill_version_files')?[{version_id:'skill-version',skill_id:'skill',content:Buffer.from('trusted skill'),stable_name:'trusted-skill',name:'fixture skill',path:'SKILL.md',media_type:'text/markdown',digest:createHash('sha256').update('trusted skill').digest('hex')}]:sql.includes('FROM thread_context_state')?[{summary:'persisted summary',summarized_through_id:'covered',summarized_through_at:null,version:7}]:sql.includes('SELECT id, author_kind, body')?[{id:'older',author_kind:'human',body:'trusted-history',attachments:[{attachmentId:'history-attachment',filename:'old.txt',mime:'text/plain'}]}]:[]}));
  const sourceRepo=new PgAgentRunRepository({withTenant:async(_org:unknown,fn:(session:unknown)=>unknown)=>fn({query:sourceQuery})} as never);
  const runs={readModelDeltas:async()=>[],claimQueued:async()=>[{kind:'executable',run:claimed}],readPinnedSkills:sourceRepo.readPinnedSkills.bind(sourceRepo),appendStep:vi.fn(),readThreadHistory:sourceRepo.readThreadHistory.bind(sourceRepo),readThreadContextState:sourceRepo.readThreadContextState.bind(sourceRepo),appendExecutionEvent:vi.fn(),failRun:vi.fn(),findLocator:async()=>null};
  const log=vi.fn();await executeQueuedRuns({runs,model:f.model,aiAdmission:f.wiring.run,clock:{now:()=>new Date().toISOString(),newStepId:()=>crypto.randomUUID()},log} as never,{orgId:org});
  expect(spy,JSON.stringify({logs:log.mock.calls,failures:runs.failRun.mock.calls})).toHaveBeenCalled();const [subject,raw]=spy.mock.calls[0]!;const assembled=JSON.parse(raw);
  expect(subject).toMatchObject({orgId:org,userId:'u',runId:'root',attemptId:'root:1',leaseEpoch:1});expect(assembled.system).toContain('pinned instructions');expect(assembled.user).toContain('private.txt');expect(assembled.history.some((entry:{content:string})=>entry.content.includes('trusted-history'))).toBe(true);
  const evidence=spy.mock.calls[0]?.[3];expect(evidence?.mappings.map(mapping=>mapping.source.kind)).toEqual(expect.arrayContaining(['history','attachment','skill','persisted-summary']));expect(evidence?.inputSha256).toBe(createHash('sha256').update(raw).digest('hex'));for(const mapping of evidence?.mappings??[]){let value:unknown=assembled;for(const key of mapping.path)value=(value as Record<string,unknown>)[String(key)];expect(mapping.componentSha256).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'));expect(mapping.classification).toBe('unknown');}const hashSource=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  expect(evidence?.mappings.find(mapping=>mapping.source.kind==='history')?.sourceSha256).toBe(hashSource('trusted-history'));
  expect(evidence?.mappings.find(mapping=>mapping.source.kind==='persisted-summary')).toMatchObject({source:{threadId:'thread',version:7,coveredCursor:'covered'},sourceSha256:hashSource('persisted summary')});
  expect(evidence?.mappings.filter(mapping=>mapping.source.kind==='skill')).toHaveLength(2);
  expect(evidence?.mappings.find(mapping=>mapping.source.kind==='skill')?.sourceSha256).toBe(hashSource('trusted skill'));
  expect(evidence?.mappings.find(mapping=>mapping.source.kind==='attachment'&&mapping.source.attachmentId==='current-attachment')).toMatchObject({source:{messageId:'message'},path:['user'],sourceSha256:hashSource({attachmentId:'current-attachment',filename:'private.txt',mime:'text/plain'})});
  expect(evidence?.mappings.find(mapping=>mapping.source.kind==='attachment'&&mapping.source.attachmentId==='history-attachment')).toMatchObject({source:{messageId:'older'},sourceSha256:hashSource((await sourceRepo.readThreadHistory(org,'thread','message',20))[0]?.attachments?.[0])});
  expect(JSON.stringify(evidence)).not.toContain('trusted-history');expect(sourceQuery).toHaveBeenCalled();
  expect(f.vendors).toBe(0);expect(runs.failRun).toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO ai_request_reservations'))).toBe(false);
 }finally{spy.mockRestore();}
});

import {SubtaskRunExecutor} from '../../src/infrastructure/agent-run/subtask-run-executor';
import {InMemorySubtaskRunStore} from '../../src/infrastructure/agent-run/in-memory-subtask-run-store';
it('real child executor assembles its own attempt/context before private SDK admission producer',async()=>{
 const f=wholeFixture(true),spy=vi.spyOn(whole,'produceWholeInputBinding');try{
  const store=new InMemorySubtaskRunStore(()=> 'child');
  await store.enqueue(org,{parentRunId:'root',description:'child raw description',context:'child source context',snapshot:{agentVersionId:'version',skillVersionIds:[],modelProvider:'route',modelId:'actual'}});
  const repo=new PgRuntimeModelUsageRepository(f.db as never,f.usage as never,undefined,f.wiring.runtime);
  const complete=vi.fn(async(call:import('../../src/application/agent-run/ports').ModelCallInput)=>{
   const serializedBody=JSON.stringify({model:call.modelId,max_tokens:5,messages:[{role:'system',content:call.system},{role:'user',content:call.user}],skills:call.skills});
   await repo.admitRuntimeRequest(org,call.runId!,{requestId:'ad05ca76-9ff5-459b-955f-73634b36ec23',attemptId:call.executionAttemptId!,leaseEpoch:call.executionLeaseEpoch!,startedAt:new Date().toISOString(),modelId:call.modelId,callPurpose:'primary',serializedBody,outputTokenLimit:5,logicalCallId:JSON.stringify([call.runId,'primary',createHash('sha256').update(serializedBody).digest('hex')])});
   throw new Error('unexpected allowed vendor');
  });
  const executor=new SubtaskRunExecutor(store,{withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>work({query:async()=>({rows:[{instructions:'pinned parent instructions'}]})})} as never,{complete} as never,{error:vi.fn(),info:vi.fn(),warn:vi.fn()} as never,false,new Map([['route',1000]]));
  await executor.tick(org);expect(complete).toHaveBeenCalledOnce();expect(spy).toHaveBeenCalled();
  const [subject,body]=spy.mock.calls[0]!;expect(subject).toMatchObject({runId:'child',rootRunId:'root',leaseEpoch:1,origin:'private-sdk-body'});expect(subject.attemptId).toBe(complete.mock.calls[0]![0].executionAttemptId);
  const actual=JSON.parse(body);expect(actual.messages[0].content).toBe('pinned parent instructions');expect(actual.messages[1].content).toContain('child source context');expect(actual.messages[1].content).toContain('child raw description');
  expect(f.query.mock.calls.some(([sql])=>/INSERT INTO (ai_request_reservations|model_request_starts)/.test(sql))).toBe(false);expect((await store.get(org,'child'))?.status).toBe('failed');
 }finally{spy.mockRestore();}
});

import {readSelectedContextSourceLineage} from '../../src/application/agent-run/context-pack-source-lineage';
function selectedFixture(recordedConfidential=false,currentConfidential=false){
 const candidate={segmentId:'selected',content:'entire selected source',sourceType:'file' as const,artifactVersionId:'version',anchor:{page:1},retrievalReasons:['recall' as const],channels:['fts' as const],score:0.5,permissionDecisionId:'real-original-decision',relevance:0.9,relevanceProvenance:'fixture explicit original replay',tokens:10,fingerprint:'selected',confidential:recordedConfidential};
 const recorded={...run,candidates:[candidate,{...candidate,segmentId:'discarded',fingerprint:'discarded',content:'unselected secret',relevance:0.01}]};
 const row={run:recorded,contentHash:packContentHash(assembleFromRecorded(recorded,null)),pinnedSnapshotId:null};
 const store={findRecorded:vi.fn().mockResolvedValue(row),confidentialNow:vi.fn().mockResolvedValue(new Set(currentConfidential?['selected']:[]))};
 const constraints={resolve:vi.fn().mockResolvedValue({localOnly:false,source:'org-policy',reason:'existing identity authority'})};
 const bindings={resolve:vi.fn(async(_org:unknown,_user:unknown,_run:unknown,digest:string)=>({contextPackRunId:'context-run',inputSha256:digest,completeInput:true,requiredCapabilities:[]}))};
 return {store,constraints,bindings,row};
}
for(const flags of [[false,false],[true,false],[false,true],[true,true]])it(`selected CP replay source uses recorded/current confidentiality union ${flags}`,async()=>{
 const f=selectedFixture(flags[0],flags[1]),subject={orgId:org,userId:'u',rootRunId:'root',runId:'root',attemptId:'root:1',leaseEpoch:1,origin:'root-model-input' as const};
 const body=JSON.stringify({system:'trusted wrapper',user:'entire selected source',history:[{content:'entire selected source'}],unknown:'unselected secret'});
 const lineage=await readSelectedContextSourceLineage({orgId:org,userId:'u',runId:'root',serializedInput:body},f as never);
 expect(lineage?.sources).toHaveLength(1);expect(lineage?.sources[0]).toMatchObject({segmentId:'selected',source:'recorded-selected-fragment',cannotAuthorizeNewDispatch:true,classification:flags.some(Boolean)?'confidential':'non-confidential'});
 expect(JSON.stringify(lineage)).not.toMatch(/entire selected source|unselected secret/);
 const manifest=whole.produceWholeInputBinding(subject,body,lineage);
 expect(manifest.components[0]?.classification).toBe('unknown');expect(manifest.components[2]?.classification).toBe(flags.some(Boolean)?'confidential':'non-confidential');
 expect(manifest.components[3]?.classification).toBe('unknown');expect(manifest.components[4]?.classification).toBe('unknown');
 const facts=await readContextPackAiFacts({orgId:org,userId:'u',runId:'root',serializedInput:body,wholeInputSubject:subject},{bindings:{resolve:async()=>manifest},store:f.store,constraints:f.constraints} as never);
 expect(facts.confidentiality).toBe('unknown');
 const changed=whole.produceWholeInputBinding(subject,JSON.stringify({user:'prefix entire selected source'}),lineage);expect(changed.components.every(c=>c.classification==='unknown')).toBe(true);
 expect(whole.produceWholeInputBinding({...subject,userId:'foreign'},body,lineage).components.every(c=>c.classification==='unknown')).toBe(true);
 expect(whole.produceWholeInputBinding(subject,body,{...lineage!}).components.every(c=>c.classification==='unknown')).toBe(true);
});
it('CP source lineage rejects foreign authority, hash mismatch and divergent replay; body flags do not override source',async()=>{
 const body=JSON.stringify({user:'entire selected source',classification:'public',completeInput:true}),input={orgId:org,userId:'u',runId:'root',serializedInput:body};
 for(const alteration of ['tenant','principal','binding-hash','replay-hash']){
  const f=selectedFixture(true,false);
  if(alteration==='tenant')f.store.findRecorded.mockResolvedValue({...f.row,run:{...f.row.run,orgId:'foreign'}});
  if(alteration==='principal')f.store.findRecorded.mockResolvedValue({...f.row,run:{...f.row.run,query:{...f.row.run.query,principalId:'foreign'}}});
  if(alteration==='binding-hash')f.bindings.resolve.mockImplementation(async()=>({contextPackRunId:'context-run',inputSha256:'wrong',completeInput:true,requiredCapabilities:[]}));
  if(alteration==='replay-hash'){f.store.findRecorded.mockResolvedValue({...f.row,contentHash:'wrong'});await expect(readSelectedContextSourceLineage(input,f as never)).rejects.toThrow();}
  else expect(await readSelectedContextSourceLineage(input,f as never)).toBeNull();
 }
 const f=selectedFixture(true,false),lineage=await readSelectedContextSourceLineage(input,f as never);expect(lineage?.sources[0]?.classification).toBe('confidential');
});

it('private CP source/identity/model-pool readers share the caller tenant session and reject outside-pool escape',async()=>{
 const evidence=selectedFixture(true,false),f=wholeFixture(true,evidence.bindings,evidence.row,true),spy=vi.spyOn(whole,'produceWholeInputBinding');
 try{
  const serializedBody=JSON.stringify({model:'actual',max_tokens:5,messages:[{role:'user',content:'entire selected source'}]});
  const repo=new PgRuntimeModelUsageRepository(f.db as never,f.usage as never,undefined,f.wiring.runtime);
  await expect(repo.admitRuntimeRequest(org,'child',{requestId:'ad05ca76-9ff5-459b-955f-73634b36ec23',attemptId:'child:1',leaseEpoch:1,startedAt:new Date().toISOString(),modelId:'actual',callPurpose:'primary',serializedBody,outputTokenLimit:5,logicalCallId:JSON.stringify(['child','primary',createHash('sha256').update(serializedBody).digest('hex')])})).rejects.toThrow('AI_MODEL_UNAVAILABLE');
  expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM context_packs'))).toBe(true);expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM segment_text'))).toBe(true);expect(f.query.mock.calls.some(([sql])=>sql.includes('SELECT org_role, team_id'))).toBe(true);expect(f.query.mock.calls.some(([sql])=>sql.includes('SELECT id, name, kind, model_policy'))).toBe(true);
  expect(spy.mock.calls[0]?.[2]?.sources[0]).toMatchObject({classification:'confidential',cannotAuthorizeNewDispatch:true});
  expect(spy.mock.results[0]?.value.components.every((component:whole.WholeInputManifest['components'][number])=>component.classification==='unknown')).toBe(true);
  // Independently exercise both wired model-pool readers with the same scoped DB.
  const scoped={withTenant:async(tenant:unknown,work:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return work({query:f.query});}};
  await f.wiring.runtime.dependencies(org,scoped as never).currentCandidates();
  await f.wiring.inputOnly!.dependencies(org,scoped as never).currentCandidates();
  expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM models m'))).toBe(true);
  expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO ai_request_reservations'))).toBe(false);
 }finally{spy.mockRestore();}
});

it('legacy selected source without an explicit recorded confidentiality fact stays unknown',async()=>{
 const f=selectedFixture(false,false);const candidate={...f.row.run.candidates[0],confidential:undefined};
 f.store.findRecorded.mockResolvedValue({...f.row,run:{...f.row.run,candidates:[candidate,...f.row.run.candidates.slice(1)]}} as never);
 expect(await readSelectedContextSourceLineage({orgId:org,userId:'u',runId:'root',serializedInput:JSON.stringify({user:'entire selected source'})},f as never)).toBeNull();
});

it('local-only identity routing stays distinct from non-confidential selected source facts',async()=>{
 const f=selectedFixture(false,false);f.constraints.resolve.mockResolvedValue({localOnly:true,source:'org-policy',reason:'existing local-only requirement'});
 const subject={orgId:org,userId:'u',rootRunId:'root',runId:'root',attemptId:'root:1',leaseEpoch:1,origin:'root-model-input' as const},body=JSON.stringify({user:'entire selected source'});
 const lineage=await readSelectedContextSourceLineage({orgId:org,userId:'u',runId:'root',serializedInput:body},f as never);
 expect(lineage?.sources[0]?.classification).toBe('non-confidential');expect(lineage?.localOnlyRequired).toBe(true);
 const manifest=whole.produceWholeInputBinding(subject,body,lineage);expect(manifest.localOnlyRequired).toBe(true);expect(manifest.components[1]?.classification).toBe('non-confidential');expect(manifest.components[0]?.classification).toBe('unknown');
 expect((await readContextPackAiFacts({orgId:org,userId:'u',runId:'root',serializedInput:body,wholeInputSubject:subject},{bindings:{resolve:async()=>manifest},store:f.store,constraints:f.constraints} as never)).confidentiality).toBe('unknown');
});

it('module-issued assembly cannot survive wrong owner, version edits, body claims or changed native clone',()=>{
 const subject={orgId:org,userId:'u',rootRunId:'root',runId:'root',attemptId:'root:1',leaseEpoch:1,origin:'root-model-input' as const};
 const original={modelProvider:'route',modelId:'actual',system:'system',user:'user',skills:[{versionId:'v1',content:'skill',stableName:'skill',name:'skill'}]};
 bindRootAssembly(original,subject,[{source:{kind:'skill',versionId:'v1'},sourceSha256:createHash('sha256').update(JSON.stringify('skill')).digest('hex'),path:['skills',0,'content']}]);
 expect(readRootAssembly(original,subject)?.mappings[0]?.source).toEqual({kind:'skill',versionId:'v1'});
 expect(readRootAssembly(original,{...subject,userId:'foreign'})).toBeNull();
 const clone={...original};inheritRootAssembly(original,clone);expect(readRootAssembly(clone,subject)).not.toBeNull();
 for(const changed of [{...original,user:'changed'},{...original,skills:[{...original.skills[0]!,versionId:'v2'}]}]){inheritRootAssembly(original,changed);expect(readRootAssembly(changed,subject)).toBeNull();}
 expect(readRootAssembly({...original,classification:'public'} as never,subject)).toBeNull();
});

it('disabled assembly provenance does not serialize input or evaluate sources',()=>{
 const input={modelProvider:'route',modelId:'actual',system:'system',user:'user',toJSON:()=>{throw new Error('must not serialize');}};
 const sources=vi.fn(()=>{throw new Error('must not enumerate');});
 const subject={orgId:org,userId:'u',rootRunId:'root',runId:'root',attemptId:'',leaseEpoch:0,origin:'root-model-input' as const};
 expect(bindRootAssembly(input,subject,sources,false)).toBe(input);expect(sources).not.toHaveBeenCalled();
});
