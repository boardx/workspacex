import {produceWholeInputBinding} from "../../src/application/agent-run/whole-input-binding-producer";
import {it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {toOrgId} from "../../src/domain/org-id";
import {SubtaskRunExecutor} from "../../src/infrastructure/agent-run/subtask-run-executor";
import {InMemorySubtaskRunStore} from "../../src/infrastructure/agent-run/in-memory-subtask-run-store";
import {PgAgentRunRepository} from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import {readPrivateChildSources} from "../../src/infrastructure/agent-run/private-child-source-reader";
import {assembleChildSourceInput,readChildSourceInput,inheritChildSourceInput,mapChildSourcesToSdkBody,matchesChildSdkEvidence} from "../../src/application/agent-run/child-input-source-provenance";
import type {ModelCallInput} from "../../src/application/agent-run/ports";
import type {SubtaskRun} from "../../src/application/agent-run/subtask-run-queue";
const org=toOrgId("child-source-org"),hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshot={agentVersionId:"version",skillVersionIds:["skill-version"],modelProvider:"route",modelId:"actual"};
const skills=[{versionId:"skill-version",content:"real pinned skill",stableName:"skill",name:"fixture"}];
function sourceDb(run:SubtaskRun){
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes("SELECT v.instructions"))return {rows:[{instructions:"published instructions"}]};
  if(sql.includes("SELECT * FROM subtask_runs"))return {rows:[{id:run.id,parent_run_id:run.parentRunId,description:run.description,context:run.context,status:run.status,agent_version_id:run.snapshot.agentVersionId,skill_version_ids:run.snapshot.skillVersionIds,model_provider:"route",model_id:"actual",artifact_refs:[],result:null,error:null,created_at:new Date(0),updated_at:new Date(0),cancel_requested_at:null,cancellation_state:null}]};
  if(sql.includes("FROM skill_version_files"))return {rows:[{version_id:"skill-version",skill_id:"skill",content:Buffer.from("real pinned skill"),stable_name:"skill",name:"fixture",path:"SKILL.md",media_type:"text/markdown",digest:createHash("sha256").update("real pinned skill").digest("hex")}]};
  throw new Error("unexpected source SQL");
 });
 const db={withTenant:async(tenant:unknown,fn:(s:unknown)=>unknown)=>{expect(tenant).toBe(org);return fn({query});}};
 return {db,query};
}
it("actual child executor and same-session PG readers map exact SDK fragments; wrappers stay unknown",async()=>{
 const store=new InMemorySubtaskRunStore(()=>"child");
 const run=await store.enqueue(org,{parentRunId:"root",description:"real description",context:"real context",snapshot});
 const {db,query}=sourceDb({...run,status:"running"});let proof;
 const model={complete:vi.fn(async(input:ModelCallInput)=>{
  const state=(await store.readExecution(org,"child"))!;
  const subject={orgId:org,rootRunId:"root",runId:"child",attemptId:state.executionAttemptId!,leaseEpoch:state.leaseEpoch};
  const assembly=readChildSourceInput(input,subject);expect(assembly).not.toBeNull();
  expect(assembly?.mappings.map(mapping=>mapping.source.kind)).toEqual(["parent-instructions","child-description","child-context","skill"]);
  expect(assembly?.mappings.map(mapping=>mapping.sourceSha256)).toEqual([hash("published instructions"),hash("real description"),hash("real context"),hash("real pinned skill")]);
  expect(assembly?.inputSha256).toBe(hash(input));expect(JSON.stringify(assembly)).not.toMatch(/published instructions|real description|real context|real pinned skill/);
  const body=JSON.stringify({model:"actual",messages:[{role:"system",content:input.system},{role:"user",content:input.user}],tools:[{description:"unknown tool"}],classification:"public",completeInput:true});
  proof=await readPrivateChildSources(db as never,{...subject,userId:"u"},body);
  expect(proof?.mappings.map(mapping=>mapping.source.kind)).toEqual(["parent-instructions","child-description","child-context"]);
  const whole=produceWholeInputBinding({...subject,userId:"u",origin:"private-sdk-body"},body,null,null,proof);expect(whole.childEvidence).toBe(proof);expect(whole.components[0]?.classification).toBe("unknown");expect(produceWholeInputBinding({...subject,userId:"foreign",origin:"private-sdk-body"},body,null,null,proof).childEvidence).toBeUndefined();
  expect(proof?.mappings.every(mapping=>mapping.classification==="unknown")).toBe(true);expect(proof?.confidentiality).toBe("unknown");
  expect(matchesChildSdkEvidence(proof!,{...subject,userId:"u"},body)).toBe(true);expect(matchesChildSdkEvidence(proof!,{...subject,userId:"u",rootRunId:"foreign"},body)).toBe(false);expect(matchesChildSdkEvidence(proof!,{...subject,userId:"u"},body+" ")).toBe(false);
  expect(mapChildSourcesToSdkBody(assembly!,subject,JSON.stringify({messages:[{role:"user",content:"prefix "+input.user}]}))).toEqual([]);
  expect(mapChildSourcesToSdkBody({...assembly!},subject,body)).toEqual([]);
  const changed={...input,user:"altered"};inheritChildSourceInput(input,changed);expect(readChildSourceInput(changed,subject)).toBeNull();
  expect(readChildSourceInput(input,{...subject,leaseEpoch:subject.leaseEpoch+1})).toBeNull();
  return {text:"source test result"};
 })};
 const executor=new SubtaskRunExecutor(store,db as never,model,{error:vi.fn(),info:vi.fn(),warn:vi.fn()} as never,false,new Map([["route",1000]]),undefined,undefined,undefined,new PgAgentRunRepository(db as never),undefined,undefined,true);
 await executor.tick(org);expect(model.complete).toHaveBeenCalledOnce();expect((await store.get(org,"child"))?.status).toBe("completed");expect(proof).toBeDefined();
 expect(query.mock.calls.some(([sql])=>/FOR UPDATE|UPDATE |INSERT /.test(sql))).toBe(false);
});
it("disabled source binding never serializes input",()=>{
 const input={modelProvider:"route",modelId:"actual",system:"system",user:"user",toJSON:()=>{throw new Error("must not serialize");}};
 expect(assembleChildSourceInput(input,org,{} as never,{} as never,"",null,[],false)).toBe(input);
});
it("changed child, attempt, pinned skill or parent identity cannot issue proof",()=>{
 const run={id:"child",parentRunId:"root",description:"description",context:null,status:"running",snapshot,artifactRefs:[],result:null,error:null,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()} satisfies SubtaskRun;
 const state={run,executionAttemptId:"child:1",leaseEpoch:1,remoteRunId:null,remoteThreadId:null};
 const input={modelProvider:"route",modelId:"actual",system:"instructions",user:"description",skills,orgId:String(org),runId:"child",executionAttemptId:"child:1",executionLeaseEpoch:1};
 for(const altered of [{...input,runId:"foreign"},{...input,executionAttemptId:"child:2"},{...input,skills:[{...skills[0]!,versionId:"changed"}]}])expect(()=>assembleChildSourceInput(altered,org,run,state,"instructions",null,skills,true)).toThrow("AI_CHILD_SOURCE_IDENTITY_MISMATCH");
 expect(()=>assembleChildSourceInput(input,org,run,{...state,run:{...run,parentRunId:"foreign"}},"instructions",null,skills,true)).toThrow("AI_CHILD_SOURCE_IDENTITY_MISMATCH");
});

it("unresolved native reference does not masquerade as a matched SDK context source",async()=>{
 const {NATIVE_SUBTASK_CONTEXT_PREFIX}=await import('@repo/contracts/standard-subtask-tools');
 const run={id:'child',parentRunId:'root',description:'description',context:NATIVE_SUBTASK_CONTEXT_PREFIX+'{"refs":[]}',status:'running',snapshot:{...snapshot,skillVersionIds:[]},artifactRefs:[],result:null,error:null,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()} satisfies SubtaskRun;
 const f=sourceDb(run),subject={orgId:org,userId:'u',rootRunId:'root',runId:'child',attemptId:'child:1',leaseEpoch:1};
 const body=JSON.stringify({messages:[{role:'system',content:'published instructions'},{role:'user',content:'description\n\nContext:\nactual authorized content'}],classification:'public'});
 const proof=await readPrivateChildSources(f.db as never,subject,body);
 expect(proof?.unresolvedNativeContext).toBe(true);expect(proof?.confidentiality).toBe('unknown');expect(proof?.mappings.map(mapping=>mapping.source.kind)).toEqual(['parent-instructions']);
 expect(matchesChildSdkEvidence(proof!,{...subject,userId:'foreign'},body)).toBe(false);
});
