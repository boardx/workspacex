import {createHash} from "node:crypto";
import type {OrgId} from "../../domain/org-id";
import type {ModelCallInput,PinnedSkillContent} from "./ports";
import type {SubtaskRun,SubtaskExecutionState} from "./subtask-run-queue";

export interface ChildSourceSubject {
 readonly orgId:OrgId;readonly rootRunId:string;readonly runId:string;
 readonly attemptId:string;readonly leaseEpoch:number;
}
export interface ChildSourceMapping {
 readonly source: {readonly kind:"parent-instructions";readonly agentVersionId:string}
  | {readonly kind:"child-description"|"child-context"|"resolved-child-context";readonly subtaskId:string}
  | {readonly kind:"skill";readonly versionId:string};
 readonly sourceSha256:string;readonly componentSha256:string;
 readonly path:readonly(string|number)[];readonly classification:"unknown";
}
export interface ChildAssemblyEvidence {
 readonly subject:ChildSourceSubject;readonly inputSha256:string;
 readonly mappings:readonly ChildSourceMapping[];readonly confidentiality:"unknown";
}
const issued=new WeakMap<ModelCallInput,ChildAssemblyEvidence>();
const proofs=new WeakSet<object>();
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Existing child queue and published snapshot are the source authority. No model/body
 * classification is read. Resolved native context is distinct from the stored reference.
 */
export function assembleChildSourceInput(input:ModelCallInput,orgId:OrgId,run:SubtaskRun,state:SubtaskExecutionState,
 instructions:string,resolvedContext:string|null,skills:readonly PinnedSkillContent[],enabled:boolean):ModelCallInput {
 if(!enabled)return input;
 if(state.run.id!==run.id||state.run.parentRunId!==run.parentRunId||state.run.status!=="running"
  ||state.run.cancellation||!state.executionAttemptId||state.leaseEpoch<1
  ||input.orgId!==String(orgId)||input.runId!==run.id||input.executionAttemptId!==state.executionAttemptId
  ||input.executionLeaseEpoch!==state.leaseEpoch||input.system!==instructions
  ||input.user!==(resolvedContext?`${run.description}\n\nContext:\n${resolvedContext}`:run.description)
  ||skills.length!==run.snapshot.skillVersionIds.length
  ||skills.some((skill,index)=>skill.versionId!==run.snapshot.skillVersionIds[index])
  ||JSON.stringify(input.skills??[])!==JSON.stringify(skills))throw new Error("AI_CHILD_SOURCE_IDENTITY_MISMATCH");
 const mapping=(source:ChildSourceMapping["source"],value:unknown,path:readonly(string|number)[],component:unknown):ChildSourceMapping=>
  Object.freeze({source:Object.freeze({...source}),sourceSha256:hash(value),componentSha256:hash(component),path:Object.freeze([...path]),classification:"unknown"});
 const mappings=[mapping({kind:"parent-instructions",agentVersionId:run.snapshot.agentVersionId},instructions,["system"],input.system),
  mapping({kind:"child-description",subtaskId:run.id},run.description,["user"],input.user),
  ...(run.context===null||resolvedContext===null?[]:[mapping({kind:"child-context",subtaskId:run.id},run.context,["user"],input.user)]),
  ...(resolvedContext===null||resolvedContext===run.context?[]:[mapping({kind:"resolved-child-context",subtaskId:run.id},resolvedContext,["user"],input.user)]),
  ...skills.map((skill,index)=>mapping({kind:"skill",versionId:skill.versionId},skill.content,["skills",index,"content"],skill.content))];
 const evidence:ChildAssemblyEvidence=Object.freeze({subject:Object.freeze({orgId,rootRunId:run.parentRunId,runId:run.id,attemptId:state.executionAttemptId,leaseEpoch:state.leaseEpoch}),inputSha256:hash(input),mappings:Object.freeze(mappings),confidentiality:"unknown"});
 proofs.add(evidence);issued.set(input,evidence);return input;
}
export function readChildSourceInput(input:ModelCallInput,subject:ChildSourceSubject):ChildAssemblyEvidence|null {
 const evidence=issued.get(input);
 if(!evidence||evidence.inputSha256!==hash(input)||Object.keys(subject).some(key=>subject[key as keyof ChildSourceSubject]!==evidence.subject[key as keyof ChildSourceSubject]))return null;
 return evidence;
}
/** Extra native envelope fields are unknown. Existing source-bearing fields may not change. */
export function inheritChildSourceInput(original:ModelCallInput,clone:ModelCallInput):void {
 const evidence=issued.get(original);if(!evidence||evidence.inputSha256!==hash(original))return;
 if(Object.keys(original).some(key=>JSON.stringify((original as unknown as Record<string,unknown>)[key])!==JSON.stringify((clone as unknown as Record<string,unknown>)[key])))return;
 const inherited=Object.freeze({...evidence,inputSha256:hash(clone)});proofs.add(inherited);issued.set(clone,inherited);
}
/** An exact SDK message match is only a fragment. Other SDK messages/tools/wrappers
 * remain unknown; no partial match can classify a whole HTTP request as public.
 */
export function mapChildSourcesToSdkBody(evidence:ChildAssemblyEvidence,subject:ChildSourceSubject,serializedBody:string):readonly ChildSourceMapping[] {
 if(!proofs.has(evidence)||Object.keys(subject).some(key=>subject[key as keyof ChildSourceSubject]!==evidence.subject[key as keyof ChildSourceSubject]))return [];
 let body:unknown;try{body=JSON.parse(serializedBody);}catch{return [];}
 if(!body||typeof body!=="object"||!Array.isArray((body as {messages?:unknown}).messages))return [];
 const messages=(body as {messages:unknown[]}).messages;
 return Object.freeze(messages.flatMap((message,index)=>{
  if(!message||typeof message!=="object")return [];
  const {role,content}=message as {role?:unknown;content?:unknown};
  if(typeof content!=="string"||!["system","user","human"].includes(String(role)))return [];
  const componentSha256=hash(content);
  return evidence.mappings.filter(mapping=>mapping.componentSha256===componentSha256
   &&((mapping.path[0]==="system"&&role==="system")||(mapping.path[0]==="user"&&(role==="user"||role==="human"))))
   .map(mapping=>Object.freeze({...mapping,path:Object.freeze(["messages",index,"content"]),componentSha256}));
 }));
}

export interface ChildSdkSubject extends ChildSourceSubject {readonly userId:string}
export interface ChildSdkEvidence {
 readonly subject:ChildSdkSubject;readonly inputSha256:string;
 readonly mappings:readonly ChildSourceMapping[];readonly confidentiality:"unknown";
 readonly unresolvedNativeContext:boolean;
}
const sdkProofs=new WeakSet<object>();
export function produceChildSdkEvidence(assembly:ChildAssemblyEvidence,subject:ChildSdkSubject,serializedBody:string,unresolvedNativeContext:boolean):ChildSdkEvidence|null {
 if(!proofs.has(assembly)||!subject.userId||Object.keys(assembly.subject).some(key=>subject[key as keyof ChildSourceSubject]!==assembly.subject[key as keyof ChildSourceSubject]))return null;
 const result:ChildSdkEvidence=Object.freeze({subject:Object.freeze({...subject}),inputSha256:createHash("sha256").update(serializedBody).digest("hex"),mappings:mapChildSourcesToSdkBody(assembly,assembly.subject,serializedBody),confidentiality:"unknown",unresolvedNativeContext});
 sdkProofs.add(result);return result;
}
export function matchesChildSdkEvidence(evidence:ChildSdkEvidence,subject:ChildSdkSubject,serializedBody:string):boolean {
 return sdkProofs.has(evidence)&&evidence.inputSha256===createHash("sha256").update(serializedBody).digest("hex")
  &&["orgId","userId","rootRunId","runId","attemptId","leaseEpoch"].every(key=>subject[key as keyof ChildSdkSubject]===evidence.subject[key as keyof ChildSdkSubject]);
}
