import {createHash} from 'node:crypto';
import type {OrgId} from '../../domain/org-id';
export interface WholeInputSubject {
 readonly orgId:OrgId;readonly userId:string;readonly rootRunId:string;readonly runId:string;
 readonly attemptId:string;readonly leaseEpoch:number;readonly origin:'root-model-input'|'private-sdk-body';
}
export interface WholeInputManifest {
 readonly kind:'whole-input';readonly contextPackRunId:null;readonly subject:WholeInputSubject;
 readonly inputSha256:string;readonly byteLength:number;readonly completeEnumeration:true;
 readonly components:readonly {readonly ordinal:number;readonly sha256:string;readonly classification:'unknown'}[];
 readonly requiredCapabilities:readonly string[];
}
const issued=new WeakSet<object>();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** In-memory metadata only. Enumeration proves coverage, never confidentiality.
 * The raw envelope digest covers duplicates, unknown fields and every exact byte;
 * parsed components supplement it but cannot replace that envelope or classify it.
 */
export function produceWholeInputBinding(subject:WholeInputSubject,serializedInput:string):WholeInputManifest {
 if(!subject.orgId||!subject.userId||!subject.rootRunId||!subject.runId||!subject.attemptId
  ||!Number.isSafeInteger(subject.leaseEpoch)||subject.leaseEpoch<1||!['root-model-input','private-sdk-body'].includes(subject.origin))throw new Error('AI_WHOLE_INPUT_SUBJECT_INVALID');
 const pieces=[serializedInput];
 try{const parsed:unknown=JSON.parse(serializedInput);if(parsed&&typeof parsed==='object')pieces.push(...Object.values(parsed).map(value=>JSON.stringify(value)));}catch{ /* Raw envelope remains complete, unknown. */ }
 const manifest:WholeInputManifest=Object.freeze({kind:'whole-input',contextPackRunId:null,subject:Object.freeze({...subject}),
  inputSha256:hash(serializedInput),byteLength:Buffer.byteLength(serializedInput),completeEnumeration:true,
  components:Object.freeze(pieces.map((piece,ordinal)=>Object.freeze({ordinal,sha256:hash(piece),classification:'unknown' as const}))),requiredCapabilities:Object.freeze([])});
 issued.add(manifest);return manifest;
}
export function matchesWholeInputBinding(binding:WholeInputManifest,subject:WholeInputSubject,serializedInput:string):boolean {
 return issued.has(binding)&&binding.subject.orgId===subject.orgId&&binding.subject.userId===subject.userId&&binding.subject.runId===subject.runId
  &&binding.subject.rootRunId===subject.rootRunId&&binding.subject.attemptId===subject.attemptId&&binding.subject.leaseEpoch===subject.leaseEpoch&&binding.subject.origin===subject.origin
  &&binding.inputSha256===hash(serializedInput)&&binding.byteLength===Buffer.byteLength(serializedInput);
}
