import {assertRunCoreModelSnapshot} from "../model/pg-org-core-model-repository";
import type {OrgCoreModelAvailability} from "../../application/model/org-core-model-ports";
import type {NativeBoundRegistration} from "./native-quota-wiring";
import {readPrivateChildSources} from "./private-child-source-reader";
import type {ChildSdkEvidence} from "../../application/agent-run/child-input-source-provenance";
import {readRootAssembly,type RootAssemblyEvidence} from "../../application/agent-run/root-input-source-provenance";
import {PgModelPoolRepository} from "../model/pg-model-pool-repository";
import {PgIdentityRepository} from "../identity/pg-identity-repository";
import {readSelectedContextSourceLineage} from "../../application/agent-run/context-pack-source-lineage";
import {produceWholeInputBinding,type WholeInputSubject} from "../../application/agent-run/whole-input-binding-producer";
import {VerifiedInputOnlyBoundRegistry,type InputOnlyModelBoundRegistration} from '../../application/agent-run/verified-input-only-bound-registry';
import type {InputOnlyRuntimeAdmissionOptions} from '../../application/agent-run/admit-priced-input-only-call';
import type {OrgId} from "../../domain/org-id";
import type {DatabasePort} from "../../application/ports/database.port";
import type {IdentityRepository} from "../../application/identity/ports";
import type {ModelPoolRepository} from "../../application/model/ports";
import type {ModelCallPort,TokenUsageMeterPort} from "../../application/agent-run/ports";
import type {RunAiAdmission} from "../../application/agent-run/priced-run-model";
import type {AiModelSelection} from "../../application/agent-run/execute-priced-model-call";
import {VerifiedModelBoundRegistry,type ModelBoundRegistration} from "../../application/agent-run/verified-model-bound-registry";
import {readContextPackAiFacts,type AiContextPackBindingPort} from "../../application/agent-run/context-pack-ai-facts";
import {PgAiAdmissionRepository} from "../auth/pg-ai-admission-repository";
import type {RuntimeAiAdmissionOptions} from "../auth/pg-runtime-model-usage-repository";
import {PgContextPackStore} from "../context-pack/pg-context-pack-store";
import {IdentityModelConstraint} from "../context-pack/identity-model-constraint";

/** Trusted deployment code supplies verified registrations and assembler bindings. There is
 * no public config endpoint, dynamic code loader, guessed price/model/count or public default.
 */
export interface AiQuotaRuntimeConfiguration {
 /** Trusted text-purpose requirements for organization core selection; absent/empty fails closed. */
 readonly coreModelRequiredCapabilities?:readonly string[];
 /** Native tariffs require separately verified endpoint/account bounds; catalog entries cannot grant dispatch. */
 readonly nativeBounds?:readonly NativeBoundRegistration[];
 readonly inputOnlyModelBounds?:readonly InputOnlyModelBoundRegistration[];
 readonly modelBounds:readonly ModelBoundRegistration[];
 /** Optional legacy CP fragment evidence; never authoritative whole-input classification. */
 readonly contextBindings?:AiContextPackBindingPort;
 readonly privateRuntimeProvider:string;
 readonly selection:(orgId:OrgId,runId:string,selection:AiModelSelection,scopedDb?:DatabasePort)=>Promise<void>;
}
export const AI_QUOTA_RUNTIME_CONFIGURATION=Symbol("AiQuotaRuntimeConfiguration");
export const AI_QUOTA_RUNTIME_WIRING=Symbol("AiQuotaRuntimeWiring");
/** Kept separate from Token model wiring to avoid model/provider dependency cycles. */
export const NATIVE_AI_QUOTA_RUNTIME_WIRING=Symbol("NativeAiQuotaRuntimeWiring");
export interface AiQuotaRuntimeWiring {readonly run:RunAiAdmission;readonly runtime:RuntimeAiAdmissionOptions;readonly inputOnly?:InputOnlyRuntimeAdmissionOptions;}
export function createAiQuotaRuntimeWiring(enabled:boolean,configuration:AiQuotaRuntimeConfiguration|null,deps:{
 readonly coreModels?:OrgCoreModelAvailability;
 readonly db:DatabasePort;readonly identity:IdentityRepository;readonly pool:ModelPoolRepository;
 readonly model:ModelCallPort;readonly usage:TokenUsageMeterPort;
}):AiQuotaRuntimeWiring|null{
 if(!enabled)return null;
 if(!configuration?.modelBounds.length||!configuration.privateRuntimeProvider||!configuration.selection)
  throw new Error("AI_RUNTIME_REQUIRED_CONFIGURATION_MISSING");
 const registry=new VerifiedModelBoundRegistry(deps.model,configuration.modelBounds),budget=new PgAiAdmissionRepository(deps.db);
 const inputRegistry=new VerifiedInputOnlyBoundRegistry(configuration.inputOnlyModelBounds??[]);
 const inputOnly:InputOnlyRuntimeAdmissionOptions={provider:configuration.privateRuntimeProvider,
  primaryModelId:modelId=>inputRegistry.formalModelId(configuration.privateRuntimeProvider,modelId),
  dependencies:(orgId,scopedDb)=>({currentCandidates:()=>inputRegistry.currentCandidates(scopedDb?new PgModelPoolRepository(scopedDb):deps.pool,String(orgId)),measure:inputRegistry.measure.bind(inputRegistry)})};
 const facts=async(subject:WholeInputSubject,serializedInput:string,scopedDb?:DatabasePort,assemblyEvidence?:RootAssemblyEvidence|null,childEvidence?:ChildSdkEvidence|null)=>{
  const {orgId,userId,runId}=subject;
  const db=scopedDb??deps.db;
  await assertRunCoreModelSnapshot(db,deps.coreModels,orgId,subject.rootRunId);
  const constraints=new IdentityModelConstraint(scopedDb?new PgIdentityRepository(scopedDb):deps.identity);
  const store=new PgContextPackStore(db,orgId,constraints,userId);
  const lineage=configuration.contextBindings?await readSelectedContextSourceLineage({orgId,userId,runId,serializedInput},{bindings:configuration.contextBindings,store,constraints}):null;
  const manifest=produceWholeInputBinding(subject,serializedInput,lineage,assemblyEvidence,childEvidence);
  return readContextPackAiFacts({orgId,userId,runId,serializedInput,wholeInputSubject:subject},{bindings:{resolve:async()=>{
    // Optional recorded-selected source evidence was consumed above. It cannot grant dispatch ACL.
    return manifest;
   }},
   store,constraints});
 };
 const boundaries=(orgId:OrgId,scopedDb?:DatabasePort)=>({model:deps.model,currentCandidates:()=>registry.currentCandidates(scopedDb?new PgModelPoolRepository(scopedDb):deps.pool,String(orgId)),measure:registry.measure.bind(registry)});
 return {inputOnly,run:{primaryModelId:(_org,run)=>registry.formalModelId(run.modelProvider,run.modelId),
  facts:(orgId,run,input)=>{const subject:WholeInputSubject={orgId,userId:run.requesterUserId,rootRunId:run.runId,runId:run.runId,attemptId:input.executionAttemptId??"",leaseEpoch:input.executionLeaseEpoch??0,origin:"root-model-input"};return facts(subject,JSON.stringify(input),undefined,readRootAssembly(input,subject));},
  dependencies:orgId=>({...boundaries(orgId),policy:budget,admission:budget,usage:deps.usage}),
  selection:(orgId,run,selection)=>configuration.selection(orgId,run.runId,selection)},
  runtime:{inputOnly,verifyReplacementBinding:(original,target)=>registry.samePrivateConnection(configuration.privateRuntimeProvider,original,target),selection:configuration.selection,primaryModelId:modelId=>registry.formalModelId(configuration.privateRuntimeProvider,modelId),dependencies:boundaries,
   facts:async(orgId,owner,serializedInput,identity,scopedDb)=>{
    if(identity.runId!==(owner.subtask_id??owner.root_run_id))throw new Error("AI_WHOLE_INPUT_SUBJECT_INVALID");
    const childEvidence=owner.subtask_id?await readPrivateChildSources(scopedDb??deps.db,{orgId,userId:owner.user_id,rootRunId:owner.root_run_id,runId:identity.runId,attemptId:identity.attemptId,leaseEpoch:identity.leaseEpoch},serializedInput):null;
    return facts({orgId,userId:owner.user_id,rootRunId:owner.root_run_id,runId:identity.runId,attemptId:identity.attemptId,leaseEpoch:identity.leaseEpoch,origin:"private-sdk-body"},serializedInput,scopedDb,undefined,childEvidence);
   }}};
}
