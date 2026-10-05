import {createHash} from 'node:crypto';
import type {OrgId} from '../../domain/org-id';
import type {ContextPackStore,ModelConstraintPort} from '../context-pack/ports';
import {replayContextPack} from '../context-pack/replay-pack';
import {packConfidentialSegmentIds} from '../context-pack/resolve-pack-model-constraint';
import {packDataScope} from '../../domain/context-pack/model-routing';
import type {AiContextPackBindingPort} from './context-pack-ai-facts';
export interface SelectedContextSource {
 readonly source:'recorded-selected-fragment';readonly cannotAuthorizeNewDispatch:true;
 readonly contextPackRunId:string;readonly segmentId:string;readonly artifactVersionId:string;
 readonly componentSha256:string;readonly classification:'confidential'|'non-confidential';
}
export interface ContextSourceLineage {
 readonly orgId:OrgId;readonly userId:string;readonly runId:string;readonly inputSha256:string;
 readonly sources:readonly SelectedContextSource[];readonly localOnlyRequired:boolean;
}
const issued=new WeakSet<object>();
/** Existing replay authority is historical, not a new-dispatch ACL grant. No text
 * escapes this reader. Only originally selected items can contribute source facts. */
export async function readSelectedContextSourceLineage(input:{orgId:OrgId;userId:string;runId:string;serializedInput:string},deps:{
 readonly bindings:AiContextPackBindingPort;readonly store:ContextPackStore;readonly constraints:ModelConstraintPort;
}):Promise<ContextSourceLineage|null>{
 const digest=createHash('sha256').update(input.serializedInput).digest('hex');
 const binding=await deps.bindings.resolve(input.orgId,input.userId,input.runId,digest);
 if(!binding||'kind' in binding||!binding.contextPackRunId||binding.inputSha256!==digest)return null;
 const row=await deps.store.findRecorded(binding.contextPackRunId);
 if(!row||row.run.orgId!==String(input.orgId)||row.run.query.principalId!==input.userId)return null;
 // Freeze the read for deterministic replay: do not classify a different second row.
 const store={...deps.store,findRecorded:async()=>row,confidentialNow:deps.store.confidentialNow.bind(deps.store)};
 const pack=await replayContextPack({store:store as ContextPackStore},{runId:binding.contextPackRunId});
 if(pack.items.some(item=>typeof row.run.candidates.find(candidate=>candidate.segmentId===item.segmentId)?.confidential!=="boolean"))return null;
 const recorded=new Set(row.run.candidates.filter(c=>c.confidential).map(c=>c.segmentId));
 const confidential=await packConfidentialSegmentIds({store:store as ContextPackStore},input.orgId,pack.items,recorded);
 const constraint=await deps.constraints.resolve({orgId:input.orgId,userId:input.userId,dataScope:packDataScope(pack.items,confidential)});
 const sources=pack.items.map(item=>Object.freeze({source:'recorded-selected-fragment' as const,cannotAuthorizeNewDispatch:true as const,
  contextPackRunId:binding.contextPackRunId,segmentId:item.segmentId,artifactVersionId:item.artifactVersionId,
  // Match the entire canonical scalar component, including its JSON encoding.
  componentSha256:createHash('sha256').update(JSON.stringify(item.content)).digest('hex'),
  classification:confidential.has(item.segmentId)?'confidential' as const:'non-confidential' as const}));
 const result=Object.freeze({orgId:input.orgId,userId:input.userId,runId:input.runId,inputSha256:digest,sources:Object.freeze(sources),localOnlyRequired:constraint.localOnly});
 issued.add(result);return result;
}
export function matchesContextSourceLineage(lineage:ContextSourceLineage,input:{orgId:OrgId;userId:string;runId:string},inputSha256:string){
 return issued.has(lineage)&&lineage.orgId===input.orgId&&lineage.userId===input.userId&&lineage.runId===input.runId&&lineage.inputSha256===inputSha256;
}
