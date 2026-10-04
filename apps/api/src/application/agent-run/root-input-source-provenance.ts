import {createHash} from "node:crypto";
import type {ModelCallInput} from "./ports";
import type {WholeInputSubject} from "./whole-input-binding-producer";

export type RootInputSource =
 | {readonly kind:"history";readonly messageId:string}
 | {readonly kind:"attachment";readonly messageId:string;readonly attachmentId:string}
 | {readonly kind:"skill";readonly versionId:string}
 | {readonly kind:"raw-user";readonly messageId:string}
 | {readonly kind:"pinned-instructions";readonly agentVersionId:string}
 | {readonly kind:"generated-summary";readonly threadId:string;readonly messageIds:readonly string[];readonly priorSummarySha256:string;readonly transcriptSha256:string;readonly priorSummaryVersion:number|null;readonly priorCoveredCursor:string|null}
 | {readonly kind:"persisted-summary";readonly threadId:string;readonly version:number;readonly coveredCursor:string|null;readonly coveredAt:string|null};
export interface RootSourceMapping {
 readonly source:RootInputSource;
 /** Exact final container, not a substring proof or a confidentiality verdict. */
 readonly path:readonly (string|number)[];
 readonly componentSha256:string;readonly sourceSha256:string;
 readonly classification:"unknown";
}
export interface RootAssemblyEvidence {
 readonly subject:WholeInputSubject;readonly inputSha256:string;readonly mappings:readonly RootSourceMapping[];
}
const evidenceIssued=new WeakSet<object>();
const issued=new WeakMap<ModelCallInput,RootAssemblyEvidence>();
export const rootSourceHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function at(input:ModelCallInput,path:readonly(string|number)[]):unknown {
 let value:unknown=input;
 for(const key of path){if(value===null||typeof value!=="object")return undefined;value=(value as Record<string,unknown>)[String(key)];}
 return value;
}
/** Application assembler only; no serialized/body metadata is interpreted as evidence. */
export function bindRootAssembly(input:ModelCallInput,subject:WholeInputSubject,sources:readonly {source:RootInputSource;sourceSha256:string;path:readonly(string|number)[]}[]|(()=>readonly {source:RootInputSource;sourceSha256:string;path:readonly(string|number)[]}[]),enabled=true):ModelCallInput {
 if(!enabled)return input;
 const resolved=typeof sources==="function"?sources():sources;
 const mappings=resolved.flatMap(({source,sourceSha256,path})=>at(input,path)===undefined?[]:[Object.freeze({source:Object.freeze({...source,...(source.kind==="generated-summary"?{messageIds:Object.freeze([...source.messageIds])}:{})}),path:Object.freeze([...path]),componentSha256:rootSourceHash(at(input,path)),sourceSha256,classification:"unknown" as const})]);
 const evidence=Object.freeze({subject:Object.freeze({...subject}),inputSha256:rootSourceHash(input),mappings:Object.freeze(mappings)});evidenceIssued.add(evidence);issued.set(input,evidence);return input;
}
export function readRootAssembly(input:ModelCallInput,subject:WholeInputSubject):RootAssemblyEvidence|null {
 const evidence=issued.get(input);
 if(!evidence||Object.keys(subject).some(key=>subject[key as keyof WholeInputSubject]!==evidence.subject[key as keyof WholeInputSubject])||evidence.inputSha256!==rootSourceHash(input))return null;
 return evidence;
}
/** Native metadata may change; source containers must remain byte-for-byte identical. */
export function inheritRootAssembly(original:ModelCallInput,clone:ModelCallInput):void {
 const evidence=issued.get(original);
 if(!evidence||evidence.inputSha256!==rootSourceHash(original)||Object.keys(original).some(key=>JSON.stringify((original as unknown as Record<string,unknown>)[key])!==JSON.stringify((clone as unknown as Record<string,unknown>)[key]))||evidence.mappings.some(mapping=>at(clone,mapping.path)===undefined||rootSourceHash(at(clone,mapping.path))!==mapping.componentSha256))return;
 const inherited=Object.freeze({...evidence,inputSha256:rootSourceHash(clone)});evidenceIssued.add(inherited);issued.set(clone,inherited);
}

export function matchesRootAssemblyEvidence(evidence:RootAssemblyEvidence,subject:WholeInputSubject,serializedInput:string):boolean {
 return evidenceIssued.has(evidence)&&Object.keys(subject).every(key=>subject[key as keyof WholeInputSubject]===evidence.subject[key as keyof WholeInputSubject])&&evidence.inputSha256===createHash("sha256").update(serializedInput).digest("hex");
}
