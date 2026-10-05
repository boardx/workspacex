import {matchesWholeInputBinding,type WholeInputSubject,type WholeInputManifest} from "./whole-input-binding-producer";
import {createHash} from "node:crypto";
import type {OrgId} from "../../domain/org-id";
import type {ContextPackStore,ModelConstraintPort} from "../context-pack/ports";
import {resolvePackModelConstraint} from "../context-pack/resolve-pack-model-constraint";
import type {AiRunPolicyFacts} from "./priced-run-model";
/** This binding comes from the trusted assembler, never request/model metadata or a policy editor.
 * A pack that covers only retrieved documents cannot classify a whole Chat/child input.
 */
export interface AiContextPackBindingPort {
 resolve(orgId:OrgId,userId:string,runId:string,inputSha256:string):Promise<{
  readonly contextPackRunId:string;readonly inputSha256:string;readonly completeInput:boolean;
  readonly requiredCapabilities:readonly string[];
 }|WholeInputManifest|null>;
}
export const aiContextInputHash=(serializedInput:string)=>createHash("sha256").update(serializedInput).digest("hex");
export async function readContextPackAiFacts(input:{orgId:OrgId;userId:string;runId:string;serializedInput:string;wholeInputSubject?:WholeInputSubject},deps:{
 readonly bindings:AiContextPackBindingPort;readonly store:ContextPackStore;readonly constraints:ModelConstraintPort;
}):Promise<AiRunPolicyFacts>{
 const unknown:AiRunPolicyFacts={confidentiality:"unknown",requiredCapabilities:[]};
 const hash=aiContextInputHash(input.serializedInput),binding=await deps.bindings.resolve(input.orgId,input.userId,input.runId,hash);
 if(!binding||binding.inputSha256!==hash)return unknown;
 if("kind" in binding){
  if(!input.wholeInputSubject||input.wholeInputSubject.orgId!==input.orgId||input.wholeInputSubject.userId!==input.userId||input.wholeInputSubject.runId!==input.runId||!matchesWholeInputBinding(binding,input.wholeInputSubject,input.serializedInput))return unknown;
  // Selected fragment facts cannot classify the rest of the actual envelope.
  return unknown;
 }
 if(!binding.completeInput)return unknown;
 const row=await deps.store.findRecorded(binding.contextPackRunId);
 if(!row||row.run.orgId!==String(input.orgId)||row.run.query.principalId!==input.userId)return unknown;
 // Existing replay integrity + recorded/current confidentiality union + identity policy authority.
 const constraint=await resolvePackModelConstraint(deps,{runId:binding.contextPackRunId,orgId:input.orgId});
 // A legacy completeInput boolean proves only the CP fragment, never the rest of
 // the actual envelope. Keep validation of the supplied fragment, but no public verdict.
 void constraint;
 return unknown;
}
