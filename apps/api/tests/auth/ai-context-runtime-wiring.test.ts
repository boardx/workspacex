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
function wholeFixture(child=false){
 const config={window:{start:'2026-10-01T00:00:00Z',end:'2026-11-01T00:00:00Z',timezone:'Etc/UTC'},ordinaryTokensPerUser:'100',costMicrosPerUser:'100',currency:'CNY',prices:[{modelId:'formal',modelProvider:'route',runtimeModelId:'actual',inputMicrosPerMillion:'1',outputMicrosPerMillion:'1',cachedInputMicrosPerMillion:'1',maxInputTokens:10,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1};
 const owner={user_id:'u',root_run_id:'root',subtask_id:child?'child':null,project_id:null,thread_id:'thread',agent_id:'agent'};
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('FROM agent_runs'))return {rows:child?[]:[owner]};if(sql.includes('FROM subtask_runs'))return {rows:child?[owner]:[]};
  if(sql.includes('FROM organizations'))return {rows:[{id:org}]};if(sql.includes('FROM org_memberships'))return {rows:[{member:1}]};
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
 const usage={startRequest:vi.fn(),record:vi.fn()};const wiring=createAiQuotaRuntimeWiring(true,{modelBounds:[registration],privateRuntimeProvider:'route',selection:async()=>{}},{db,identity:{},pool,model,usage} as never)!;
 return {wiring,db,model,usage,query,get vendors(){return vendors;}};
}
it('actual root priced boundary sends assembled fields to producer; unknown is zero reservation/vendor',async()=>{
 const f=wholeFixture(),spy=vi.spyOn(whole,'produceWholeInputBinding');try{
  const claimed={runId:'root',requesterUserId:'u',modelProvider:'route',modelId:'actual',resumeStepSeqBase:1,permissionRequestId:null,projectId:null,threadId:'thread',agentId:'agent'};
  const assembled={orgId:String(org),runId:'root',modelProvider:'route',modelId:'actual',executionAttemptId:'root:1',executionLeaseEpoch:1,system:'agent+skill+protocol',user:'raw+attachment+notice',history:[{role:'user',content:'summary+KG+tool'}],skills:[{versionId:'skill',stableName:'skill',content:'pinned'}],images:[{mime:'image/png',dataBase64:'private-pixel'}],interjection:{extra:'private'},extra:'unknown'};
  const model=pricedRunModel(f.model,org,claimed as never,f.wiring.run);
  await expect(withRunLease({orgId:org,runId:'root',epoch:1,verify:async()=>{}},()=>model.complete(assembled as never))).rejects.toThrow('AI_CONFIDENTIALITY_UNKNOWN');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({runId:'root',attemptId:'root:1',leaseEpoch:1,origin:'root-model-input'}),JSON.stringify(assembled));expect(f.vendors).toBe(0);expect(f.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO ai_request_reservations'))).toBe(false);
 }finally{spy.mockRestore();}
});
for(const child of [false,true])it(`private ${child?'child':'root'} admission sends SDK body and own identity to producer; unknown rejects`,async()=>{
 const f=wholeFixture(child),spy=vi.spyOn(whole,'produceWholeInputBinding'),runId=child?'child':'root';try{
  const repo=new PgRuntimeModelUsageRepository(f.db as never,f.usage as never,undefined,f.wiring.runtime);
  const serializedBody='{"model":"actual","max_tokens":5,"messages":[{"content":"raw-private"}],"tools":[{"name":"private-tool"}],"completeInput":true,"classification":"public"}';
  const request={requestId:'ad05ca76-9ff5-459b-955f-73634b36ec23',attemptId:runId+':1',leaseEpoch:1,startedAt:new Date().toISOString(),modelId:'actual',callPurpose:'primary' as const,serializedBody,outputTokenLimit:5,logicalCallId:JSON.stringify([runId,'primary',createHash('sha256').update(serializedBody).digest('hex')])};
  await expect(repo.admitRuntimeRequest(org,runId,request)).rejects.toThrow('AI_CONFIDENTIALITY_UNKNOWN');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({rootRunId:'root',runId,attemptId:runId+':1',leaseEpoch:1,origin:'private-sdk-body'}),serializedBody);expect(f.vendors).toBe(0);expect(f.query.mock.calls.some(([sql])=>/INSERT INTO (ai_request_reservations|model_request_starts)/.test(sql))).toBe(false);
 }finally{spy.mockRestore();}
});

import {executeQueuedRuns} from '../../src/application/agent-run/execute-run';
it('real executeQueuedRuns assembler reaches the wired producer with pinned system/history/attachment user',async()=>{
 const f=wholeFixture(),spy=vi.spyOn(whole,'produceWholeInputBinding');try{
  const claimed={runId:'root',threadId:'thread',projectId:null,inputMessageId:'message',requesterUserId:'u',inputText:'Please compare previous source',inputAttachments:[{filename:'private.txt',mime:'text/plain'}],agentId:'agent',agentVersionId:'version',instructions:'pinned instructions',skillVersionIds:[],modelProvider:'route',modelId:'actual',pendingDecision:null,leaseEpoch:1};
  const runs={readModelDeltas:async()=>[],claimQueued:async()=>[{kind:'executable',run:claimed}],readPinnedSkills:async()=>[],appendStep:vi.fn(),readThreadHistory:async()=>[{id:'older',role:'user',content:'trusted-history'}],readThreadContextState:async()=>null,appendExecutionEvent:vi.fn(),failRun:vi.fn(),findLocator:async()=>null};
  const log=vi.fn();await executeQueuedRuns({runs,model:f.model,aiAdmission:f.wiring.run,clock:{now:()=>new Date().toISOString(),newStepId:()=>crypto.randomUUID()},log} as never,{orgId:org});
  expect(spy,JSON.stringify({logs:log.mock.calls,failures:runs.failRun.mock.calls})).toHaveBeenCalled();const [subject,raw]=spy.mock.calls[0]!;const assembled=JSON.parse(raw);
  expect(subject).toMatchObject({orgId:org,userId:'u',runId:'root',attemptId:'root:1',leaseEpoch:1});expect(assembled.system).toContain('pinned instructions');expect(assembled.user).toContain('private.txt');expect(assembled.history.some((entry:{content:string})=>entry.content.includes('trusted-history'))).toBe(true);
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
