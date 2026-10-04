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
 readonly modelBounds:readonly ModelBoundRegistration[];
 readonly contextBindings:AiContextPackBindingPort;
 readonly privateRuntimeProvider:string;
 readonly selection:(orgId:OrgId,runId:string,selection:AiModelSelection)=>Promise<void>;
}
export const AI_QUOTA_RUNTIME_CONFIGURATION=Symbol("AiQuotaRuntimeConfiguration");
export const AI_QUOTA_RUNTIME_WIRING=Symbol("AiQuotaRuntimeWiring");
export interface AiQuotaRuntimeWiring {readonly run:RunAiAdmission;readonly runtime:RuntimeAiAdmissionOptions;}
export function createAiQuotaRuntimeWiring(enabled:boolean,configuration:AiQuotaRuntimeConfiguration|null,deps:{
 readonly db:DatabasePort;readonly identity:IdentityRepository;readonly pool:ModelPoolRepository;
 readonly model:ModelCallPort;readonly usage:TokenUsageMeterPort;
}):AiQuotaRuntimeWiring|null{
 if(!enabled)return null;
 if(!configuration?.modelBounds.length||!configuration.privateRuntimeProvider||!configuration.contextBindings||!configuration.selection)
  throw new Error("AI_RUNTIME_REQUIRED_CONFIGURATION_MISSING");
 const registry=new VerifiedModelBoundRegistry(deps.model,configuration.modelBounds),budget=new PgAiAdmissionRepository(deps.db);
 const facts=async(orgId:OrgId,userId:string,runId:string,serializedInput:string)=>{
  const constraints=new IdentityModelConstraint(deps.identity);
  return readContextPackAiFacts({orgId,userId,runId,serializedInput},{bindings:configuration.contextBindings,
   store:new PgContextPackStore(deps.db,orgId,constraints,userId),constraints});
 };
 const boundaries=(orgId:OrgId)=>({model:deps.model,currentCandidates:()=>registry.currentCandidates(deps.pool,String(orgId)),measure:registry.measure.bind(registry)});
 return {run:{primaryModelId:(_org,run)=>registry.formalModelId(run.modelProvider,run.modelId),
  facts:(orgId,run,input)=>facts(orgId,run.requesterUserId,run.runId,JSON.stringify(input)),
  dependencies:orgId=>({...boundaries(orgId),policy:budget,admission:budget,usage:deps.usage}),
  selection:(orgId,run,selection)=>configuration.selection(orgId,run.runId,selection)},
  runtime:{primaryModelId:modelId=>registry.formalModelId(configuration.privateRuntimeProvider,modelId),dependencies:boundaries,
   facts:(orgId,owner,serializedInput)=>facts(orgId,owner.user_id,owner.root_run_id,serializedInput)}};
}
