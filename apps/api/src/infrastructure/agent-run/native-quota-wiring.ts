import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { TokenUsageMeterPort } from "../../application/agent-run/ports";
import type { AiAdmissionPort } from "../../application/agent-run/ai-admission-ports";
import type { IdentityRepository } from "../../application/identity/ports";
import type { RecordingUnitOfWork } from "../../application/recording/session-lifecycle-ports";
import { withCommittedAiPolicyDecision } from "../../application/agent-run/committed-ai-policy-decision";
import { AiQuotaPolicyError } from "../../application/agent-run/ai-quota-policy-error";
import { PgAiAdmissionRepository } from "../auth/pg-ai-admission-repository";
import { PgTokenUsageRepository } from "../auth/pg-token-usage-repository";
import { PgAsrRequestAccounting } from "../auth/pg-asr-request-accounting";
import { resolveRuntimeModelOwner } from "../auth/pg-runtime-model-usage-repository";
import { prepareImageAiAdmission, type ImageAiAdmission, type ImageDispatchRequest } from "./image-ai-admission";
import { prepareAsrAiAdmission, type AsrNativeAdmissionPort, type AsrNativeAdmissionRequest } from "../recording/bounded-asr-admission";

export interface NativeDispatchSubject {
 readonly orgId:OrgId;readonly userId:string;readonly runId:string|null;readonly subtaskId:string|null;
 readonly projectId:string|null;readonly threadId:string|null;readonly agentId:string|null;
}
/** Deployment code owns endpoint/account verification and exact outbound request authorization. */
export interface NativeBoundRegistration {
 readonly modelProvider:string;readonly formalModelId:string;readonly runtimeModelId:string;
 readonly unit:"image"|"millisecond";readonly maximumQuantity:bigint;
 readonly verifyDeploymentBinding:()=>Promise<boolean>;
 readonly authorizeDispatch:(subject:NativeDispatchSubject,request:
  |{readonly kind:"image";readonly request:ImageDispatchRequest}
  |{readonly kind:"asr";readonly request:AsrNativeAdmissionRequest})=>Promise<boolean>;
}
export interface NativeQuotaConfiguration {readonly nativeBounds:readonly NativeBoundRegistration[];}
export interface NativeQuotaWiring {readonly image:ImageAiAdmission;readonly asr:AsrNativeAdmissionPort;}
export interface NativeQuotaDependencies {
 readonly db:DatabasePort;readonly usage:TokenUsageMeterPort;
 readonly asrRepositories?:(scoped:DatabasePort)=>{identities:IdentityRepository;recording:RecordingUnitOfWork};
}
function tenantScoped(dbSession:TenantSession,orgId:OrgId):DatabasePort {
 return {withTenant:async(org,work)=>{if(org!==orgId)throw new Error("AI_NATIVE_TENANT_DENIED");return work(dbSession);},
  withoutTenant:async()=>{throw new Error("AI_NATIVE_TENANT_REQUIRED");},close:async()=>{}};
}
export function createNativeQuotaWiring(enabled:boolean,configuration:NativeQuotaConfiguration|null,deps:NativeQuotaDependencies):NativeQuotaWiring|null {
 if(!enabled||!configuration?.nativeBounds.length)return null;
 const bounds=configuration?.nativeBounds??[];
 const bindings=new Set<string>();
 for(const bound of bounds){
  const key=JSON.stringify([bound.modelProvider,bound.runtimeModelId]);
  if(!bound.modelProvider||!bound.runtimeModelId||!bound.formalModelId||bindings.has(key)
   ||!["image","millisecond"].includes(bound.unit)||typeof bound.maximumQuantity!=="bigint"||bound.maximumQuantity<=0n
   ||bound.maximumQuantity>9223372036854775807n||typeof bound.verifyDeploymentBinding!=="function"||typeof bound.authorizeDispatch!=="function")
   throw new Error("AI_NATIVE_DEPLOYMENT_REGISTRATION_INVALID");
  bindings.add(key);
 }
 const globalAdmission=new PgAiAdmissionRepository(deps.db);
 const asrOwners=new PgAsrRequestAccounting(deps.db,deps.asrRepositories);
 const resolve=async(scoped:DatabasePort,subject:NativeDispatchSubject,request:
  |{kind:"image";request:ImageDispatchRequest}|{kind:"asr";request:AsrNativeAdmissionRequest})=>{
  const unit:"image"|"millisecond"=request.kind==="image"?"image":"millisecond";
  const registration=bounds.find(row=>row.modelProvider===request.request.modelProvider&&row.runtimeModelId===request.request.modelId&&row.unit===unit);
  if(!registration||!await registration.verifyDeploymentBinding()||!await registration.authorizeDispatch(subject,request))return null;
  const policy=await new PgAiAdmissionRepository(scoped).resolveBudgetPolicy(subject.orgId,subject.userId,"not-applicable");
  if(policy.decision!=="configured")return null;
  const price=policy.configuration.nativePrices?.find(row=>row.modelId===registration.formalModelId
   &&row.modelProvider===registration.modelProvider&&row.runtimeModelId===registration.runtimeModelId&&row.unit===unit);
  if(!price||BigInt(price.maxQuantity)>registration.maximumQuantity)return null;
  return {formalModelId:registration.formalModelId,maximumQuantity:BigInt(price.maxQuantity),
   windowStart:policy.configuration.window.start,windowEnd:policy.configuration.window.end,
   price:{unit,quantum:BigInt(price.quantum),microsPerQuantum:BigInt(price.microsPerQuantum),currency:policy.configuration.currency,version:policy.priceVersion}};
 };
 const ports=(scoped:DatabasePort)=>{
  const repository=new PgAiAdmissionRepository(scoped);
  const admission:AiAdmissionPort={reserve:async(org,input)=>{
   const result=await repository.reserve(org,input);
   if(result.decision!=="allowed")throw new AiQuotaPolicyError(result.decision,result.degradeToModelId);
   return result;
  },settle:globalAdmission.settle.bind(globalAdmission)};
  const scopedUsage=new PgTokenUsageRepository(scoped);
  const usage:TokenUsageMeterPort={startRequest:scopedUsage.startRequest.bind(scopedUsage),record:deps.usage.record.bind(deps.usage)};
  return {admission,usage};
 };
 const lock=async(session:TenantSession,orgId:OrgId)=>{await session.query("SELECT pg_advisory_xact_lock(hashtext($1))",[String(orgId)]);await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify(["ai-limit-rules",String(orgId)])]);};
 return {
  image:{start:(context,request)=>withCommittedAiPolicyDecision(deps.db,context.orgId,async session=>{
   await lock(session,context.orgId);
   const owner=await resolveRuntimeModelOwner(session,context.orgId,context.parentRunId,context.leaseEpoch,context.attemptId,"native-image");
   if(!owner?.user_id)throw new Error("AI_IMAGE_OWNER_DENIED");
   const scoped=tenantScoped(session,context.orgId);
   return prepareImageAiAdmission({...ports(scoped),resolve:async()=>{
    const binding=await resolve(scoped,{orgId:context.orgId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,
     projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id},{kind:"image",request});
    if(!binding)return null;
    return {...binding,orgId:context.orgId,userId:owner.user_id,runId:owner.root_run_id,sourceRunId:context.parentRunId,subtaskId:owner.subtask_id,executionAttemptId:context.attemptId,
     executionLeaseEpoch:context.leaseEpoch,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,
     modelProvider:request.modelProvider,modelId:request.modelId,serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex"),
     logicalCallId:JSON.stringify([context.parentRunId,context.toolCallId,"native-image"]),tokenBilling:"not-applicable",bindingVerified:true};
   }}).start(context,request);
  })},
  asr:{start:(context,request)=>withCommittedAiPolicyDecision(deps.db,context.orgId,async session=>{
   await lock(session,context.orgId);
   const owner=await asrOwners.readOwner(context,session),scoped=tenantScoped(session,context.orgId);
   return prepareAsrAiAdmission(context,request,{...ports(scoped),resolve:async()=>{
    const binding=await resolve(scoped,{orgId:context.orgId,userId:owner.user_id,runId:owner.root_run_id,subtaskId:owner.subtask_id,
     projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id},{kind:"asr",request});
    if(!binding)return null;
    return {...binding,orgId:context.orgId,userId:owner.user_id,runId:owner.root_run_id,sourceRunId:context.kind==="run"?context.runId:null,
     subtaskId:owner.subtask_id,projectId:owner.project_id,threadId:owner.thread_id,agentId:owner.agent_id,
     executionAttemptId:context.kind==="run"?context.attemptId:null,executionLeaseEpoch:context.kind==="run"?context.leaseEpoch:undefined,
     modelProvider:request.modelProvider,runtimeModelId:request.modelId,logicalCallId:JSON.stringify([context.kind,context.kind==="run"?context.runId:context.kind==="personal-capture"?context.captureId:context.kind==="recording"?context.sessionId:owner.user_id,request.requestId,"native-asr"]),
     tokenBilling:"not-applicable",bindingVerified:true};
   }});
  })},
 };
}
