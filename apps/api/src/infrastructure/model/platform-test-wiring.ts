import {Configuration} from "@repo/contracts/ai-policy";
import {createHash} from "node:crypto";
import type {PlatformModelTestRequest,PlatformModelTestCapability,PlatformModelTestCandidate} from "@repo/contracts/platform-model-test";
import type {AiBudgetPolicyPort,AiReservationInput} from "../../application/agent-run/ai-admission-ports";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../../application/agent-run/ports";
import type {VerifiedInputBound} from "../../domain/agent-run/ai-safe-attempt";
import {priceAiTokens,type AiPrice} from "../../domain/agent-run/ai-budget";
import {priceNativeAiUsage,type AiNativePrice} from "../../domain/agent-run/ai-billable-unit";
import {toOrgId} from "../../domain/org-id";
import type {DatabasePort} from "../../application/ports/database.port";
import type {ModelPoolRepository} from "../../application/model/ports";
import {PlatformModelTestService} from "../../application/model/platform-model-test";
import type {PlatformModelTestOperation,PlatformModelTestAccounting} from "../../application/model/platform-model-test-ports";
import type {PlatformModelTestReadPort} from "../../application/model/platform-model-test-read-ports";
import {PgModelPoolRepository} from "./pg-model-pool-repository";
import {PgAiAdmissionRepository} from "../auth/pg-ai-admission-repository";
import type {PgPlatformModelTestRepository} from "./pg-platform-model-test-repository";
import {PlatformTestAccounting,type PlatformTestReservationResolver} from "./platform-test-accounting";
import type {PreparedPlatformTestCall,PlatformTestClientHooks} from "./platform-test-vector-client";
export interface PlatformModelTestRegistration {
 readonly modelId:string;readonly modelProvider:string;readonly runtimeModelId:string;readonly capability:PlatformModelTestCapability;
 verifyDeploymentBinding():Promise<boolean>;
 measureSerializedBody?(body:string):Promise<VerifiedInputBound|null>;
 readonly client:{prepare(request:PlatformModelTestRequest):PreparedPlatformTestCall;invoke(prepared:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,signal?:AbortSignal):Promise<import("@repo/contracts/platform-model-test").PlatformModelTestResult>};
}
export interface PlatformModelTestWiringConfig {readonly registrations:readonly PlatformModelTestRegistration[];}
type State={registration:PlatformModelTestRegistration;prepared:PreparedPlatformTestCall;startedAt?:string;reservation?:AiReservationInput;tokenPrice?:AiPrice;nativePrice?:AiNativePrice};
type Accounting=PlatformModelTestAccounting&{assertDispatch(operation:PlatformModelTestOperation,id:string):Promise<void>};
const purpose={text:"primary","image-generation":"native-image","text-to-speech":"primary","speech-to-text":"native-asr",embedding:"retrieval-embedding",rerank:"retrieval-rerank"} as const;
const supported=(cap:PlatformModelTestCapability):cap is keyof typeof purpose=>Object.hasOwn(purpose,cap);
const key=(op:PlatformModelTestOperation)=>JSON.stringify([op.request.orgId,op.operatorUserId,op.testId]);
const sha=(body:string)=>createHash("sha256").update(body).digest("hex");
function assertPrepared(op:PlatformModelTestOperation,state:State,call=state.prepared){
 if(call.physicalReceiptId!==op.testId||call.runtimeModelId!==state.registration.runtimeModelId||call.capability!==op.request.capability||call.bounds.maximumCostMicros!==op.request.bounds.maximumCostMicros||call.serializedBody!==state.prepared.serializedBody||!Number.isSafeInteger(call.bounds.timeoutMs)||call.bounds.timeoutMs<1||call.bounds.timeoutMs>op.request.bounds.timeoutMs)throw Error("TEST_PREPARED_BINDING_INVALID");
 if(op.request.capability==="text"&&call.bounds.maxOutputTokens!==op.request.bounds.maxOutputTokens)throw Error("TEST_OUTPUT_BOUND_INVALID");
 if((op.request.capability==="image-generation"||op.request.capability==="text-to-speech"||op.request.capability==="speech-to-text")&&call.bounds.maximumQuantity!==op.request.bounds.maximumQuantity)throw Error("TEST_NATIVE_BOUND_INVALID");
}
export function createPlatformModelTestWiring(config:PlatformModelTestWiringConfig|null,deps:{db:DatabasePort;usage:TokenUsageMeterPort;repo:PgPlatformModelTestRepository;
 pool?:Pick<ModelPoolRepository,"listForOrg">;readPlan?:(orgId:string)=>Promise<"ordinary"|"enterprise"|null>;readConfiguration?:(orgId:string)=>Promise<import("zod").z.infer<typeof Configuration>|null>;policyFactory?:(db:DatabasePort)=>AiBudgetPolicyPort;accountingFactory?:(resolver:PlatformTestReservationResolver)=>Accounting;
}):{service:PlatformModelTestService;reader:PlatformModelTestReadPort}{
 const registrations=config?.registrations??[],ids=new Set<string>();
 for(const r of registrations){const id=JSON.stringify([r.modelId,r.capability]);if(ids.has(id))throw Error("TEST_DUPLICATE_REGISTRATION");ids.add(id);}
 const pool=(db:DatabasePort)=>deps.pool??new PgModelPoolRepository(db),policy=deps.policyFactory??(db=>new PgAiAdmissionRepository(db));
 const readPlan=(db:DatabasePort,orgId:string)=>deps.readPlan?deps.readPlan(orgId):db.withTenant(toOrgId(orgId),async session=>(await session.query<{plan:"ordinary"|"enterprise"}>("SELECT plan FROM organization_plans WHERE org_id=$1",[orgId])).rows[0]?.plan??null);
 const states=new Map<string,State>();
 const resolver:PlatformTestReservationResolver={resolve:async(op,scoped)=>{
  const state=states.get(key(op));if(!state||!supported(op.request.capability))throw Error("TEST_ADAPTER_DISABLED");assertPrepared(op,state);
  if(!await state.registration.verifyDeploymentBinding())throw Error("TEST_BINDING_UNVERIFIED");
  const models=await pool(scoped).listForOrg(op.request.orgId);
  if(!models.some(m=>m.row.modelId===op.request.modelId&&m.row.status==="已启用"&&m.row.shape==="single"&&m.credentialConfigured))throw Error("TEST_MODEL_UNAVAILABLE");
  if(op.request.capability==="speech-to-text"&&await readPlan(scoped,op.request.orgId)!=="enterprise")throw Error("TEST_ASR_TOKEN_BOUND_UNVERIFIED");
  const native=op.request.capability==="image-generation"||op.request.capability==="text-to-speech"||op.request.capability==="speech-to-text",nativeUnit=op.request.capability==="text-to-speech"?"character" as const:op.request.capability==="speech-to-text"?"millisecond" as const:"image" as const,budget=await policy(scoped).resolveBudgetPolicy(toOrgId(op.request.orgId),op.operatorUserId,native?"not-applicable":"token");
  if(budget.decision!=="configured")throw Error("TEST_POLICY_UNCONFIGURED");
  if(op.request.capability==="speech-to-text"&&budget.plan!=="enterprise")throw Error("TEST_ASR_TOKEN_BOUND_UNVERIFIED");
  const c=budget.configuration;let maximumTokens=0n,maximumCostMicros:bigint,nativePolicy:AiReservationInput["nativePolicy"];
  if(native){
   const p=c.nativePrices?.find(p=>p.modelId===state.registration.modelId&&p.modelProvider===state.registration.modelProvider&&p.runtimeModelId===state.registration.runtimeModelId&&p.unit===nativeUnit);
   if(!p||(op.request.capability!=="image-generation"&&op.request.capability!=="text-to-speech"&&op.request.capability!=="speech-to-text"))throw Error("TEST_NATIVE_PRICE_UNVERIFIED");
   const quantity=BigInt(op.request.bounds.maximumQuantity);if(quantity>BigInt(p.maxQuantity))throw Error("TEST_NATIVE_BOUND_INVALID");
   state.nativePrice={unit:nativeUnit,quantum:BigInt(p.quantum),microsPerQuantum:BigInt(p.microsPerQuantum),currency:c.currency,version:budget.priceVersion};
   maximumCostMicros=priceNativeAiUsage(state.nativePrice,{kind:"native",unit:nativeUnit,quantity,source:"reported"})!;nativePolicy={unit:nativeUnit,maximumQuantity:quantity};
  }else{
   const p=c.prices.find(p=>p.modelId===state.registration.modelId&&p.modelProvider===state.registration.modelProvider&&p.runtimeModelId===state.registration.runtimeModelId),m=await state.registration.measureSerializedBody?.(state.prepared.serializedBody);
   if(!p||!m||m.modelProvider!==p.modelProvider||m.runtimeModelId!==p.runtimeModelId||m.serializedBodySha256!==sha(state.prepared.serializedBody)||!Number.isSafeInteger(m.tokens)||m.tokens<0||m.tokens>p.maxInputTokens||!m.implementation||!m.version||!["provider-count","verified-tokenizer","verified-upper-bound"].includes(m.source))throw Error("TEST_INPUT_BOUND_UNVERIFIED");
   const text=op.request.capability==="text";if(text?!("maxOutputTokens" in p):!("billingMode" in p&&p.billingMode==="input-only"))throw Error("TEST_BILLING_MODE_INVALID");
   const output=text&&"maxOutputTokens" in op.request.bounds?op.request.bounds.maxOutputTokens:0;if(text&&"maxOutputTokens" in p&&output>p.maxOutputTokens)throw Error("TEST_OUTPUT_BOUND_INVALID");
   state.tokenPrice={version:budget.priceVersion,currency:c.currency,inputMicrosPerMillion:BigInt(p.inputMicrosPerMillion),cachedInputMicrosPerMillion:BigInt(p.cachedInputMicrosPerMillion),outputMicrosPerMillion:"outputMicrosPerMillion" in p?BigInt(p.outputMicrosPerMillion):0n};
   maximumTokens=BigInt(m.tokens)+BigInt(output);const inputRate=state.tokenPrice.inputMicrosPerMillion>state.tokenPrice.cachedInputMicrosPerMillion!?state.tokenPrice.inputMicrosPerMillion:state.tokenPrice.cachedInputMicrosPerMillion!;
   maximumCostMicros=priceAiTokens({...state.tokenPrice,inputMicrosPerMillion:inputRate},{input:BigInt(m.tokens),output:BigInt(output)});
  }
  if(maximumCostMicros>BigInt(op.request.bounds.maximumCostMicros))throw Error("TEST_MAXIMUM_COST_EXCEEDED");
  state.startedAt=new Date().toISOString();state.reservation={requestId:op.testId,userId:op.operatorUserId,formalModelId:state.registration.modelId,agentId:null,windowStart:c.window.start,windowEnd:c.window.end,maximumTokens,maximumCostMicros,modelProvider:state.registration.modelProvider,modelId:state.registration.runtimeModelId,currency:c.currency,priceVersion:budget.priceVersion,...(nativePolicy?{nativePolicy}:{}),...(!native&&c.tokenControls?{tokenPolicy:{primaryModelId:state.registration.modelId,selectedModelId:state.registration.modelId,allowDegradation:false}}:{})};
  return {reservation:state.reservation,startedAt:state.startedAt,callPurpose:purpose[op.request.capability]};
 }};
 const underlyingAccounting=deps.accountingFactory?.(resolver)??new PlatformTestAccounting(deps.db,deps.repo,resolver);
 const accounting:Accounting={
  reserve:async op=>{try{await underlyingAccounting.reserve(op);}catch(error){states.delete(key(op));throw error;}},
  releaseUndispatched:async op=>{try{await underlyingAccounting.releaseUndispatched(op);}finally{states.delete(key(op));}},
  settle:op=>underlyingAccounting.settle(op),assertDispatch:(op,id)=>underlyingAccounting.assertDispatch(op,id),
 };
 const adapters={resolve:async(op:PlatformModelTestOperation)=>{
  const r=registrations.find(r=>r.modelId===op.request.modelId&&r.capability===op.request.capability);
  if(!r||!supported(op.request.capability)||(op.request.capability==="speech-to-text"&&r.runtimeModelId!=="qwen3-asr-flash")||!await r.verifyDeploymentBinding())return {enabled:false as const,reason:"trusted-adapter-unavailable"};
  const prepared=r.client.prepare(op.request);Object.freeze(prepared.bounds);Object.freeze(prepared);const state:State={registration:r,prepared};assertPrepared(op,state);states.set(key(op),state);
  return {enabled:true as const,adapter:{invoke:async(_op:PlatformModelTestOperation,signal?:AbortSignal)=>{try{return await r.client.invoke(prepared,{
   beforeDispatch:async call=>{assertPrepared(op,state,call);if(!state.reservation||!state.startedAt)throw Error("TEST_NOT_RESERVED");if(!await r.verifyDeploymentBinding())throw Error("TEST_BINDING_REVOKED");await accounting.assertDispatch(op,call.physicalReceiptId);},
   terminal:async e=>{
    if(e.physicalReceiptId!==op.testId||!state.reservation||!state.startedAt)throw Error("TEST_RECEIPT_BINDING_INVALID");const u=e.usage;let cost:bigint|null=null;
    if(state.nativePrice&&u.nativeUnit===state.nativePrice.unit&&u.nativeQuantity!==null)cost=priceNativeAiUsage(state.nativePrice,{kind:"native",unit:u.nativeUnit,quantity:u.nativeQuantity,source:"reported"});
    if(state.tokenPrice&&u.inputTokens!==null&&(op.request.capability!=="text"||u.outputTokens!==null)
     &&(u.cacheInputTokens!==undefined&&u.cacheInputTokens!==null||state.tokenPrice.cachedInputMicrosPerMillion===state.tokenPrice.inputMicrosPerMillion)
     &&(op.request.capability==="text"||u.outputTokens===null||u.outputTokens===0))cost=priceAiTokens(state.tokenPrice,{input:BigInt(u.inputTokens),output:BigInt(u.outputTokens??0),...(u.cacheInputTokens==null?{}:{cachedInput:BigInt(u.cacheInputTokens)})});
    const record:TokenUsageRecord={eventId:op.testId,userId:op.operatorUserId,runId:null,projectId:null,threadId:null,agentId:null,modelProvider:r.modelProvider,modelId:r.runtimeModelId,requestStartedAt:state.startedAt,requestEndedAt:e.endedAt,callPurpose:purpose[op.request.capability as keyof typeof purpose],tokensTotal:u.tokensTotal??0,promptTokens:u.inputTokens,completionTokens:u.outputTokens,cacheInputTokens:u.cacheInputTokens??null,reasoningOutputTokens:u.reasoningOutputTokens??null,totalSource:state.nativePrice?"not-applicable":u.tokensTotal===null?"unknown":"reported",...(state.nativePrice?{nativeUsage:{unit:state.nativePrice.unit,quantity:u.nativeUnit===state.nativePrice.unit?u.nativeQuantity:null,source:u.nativeQuantity===null||u.nativeUnit!==state.nativePrice.unit?"unknown" as const:"reported" as const}}:{}),...(cost===null?{}:{costMicros:cost,currency:state.reservation.currency,priceVersion:state.reservation.priceVersion}),outcome:e.outcome};
    await deps.usage.record(toOrgId(op.request.orgId),record);
   },
  },signal);}finally{states.delete(key(op));}}}};
 }};
 const reader:PlatformModelTestReadPort={candidates:async actor=>{
  await deps.repo.authorizeActor(actor);const models=await pool(deps.db).listForOrg(actor.orgId),result:PlatformModelTestCandidate[]=[];
  const c=deps.readConfiguration?await deps.readConfiguration(actor.orgId):await deps.db.withTenant(toOrgId(actor.orgId),async session=>{
   const row=(await session.query<{configuration:unknown}>("SELECT configuration FROM organization_ai_policies WHERE org_id=$1",[actor.orgId])).rows[0];
   const parsed=Configuration.safeParse(row?.configuration);return parsed.success?parsed.data:null;
  });
  const plan=await readPlan(deps.db,actor.orgId);
  for(const model of models){if(model.row.status!=="已启用"||model.row.shape!=="single"||!model.credentialConfigured)continue;
   for(const capability of ["text","image-generation","text-to-speech","speech-to-text","embedding","rerank"] as const){
    const r=registrations.find(r=>r.modelId===model.row.modelId&&r.capability===capability);let verified=!!r&&supported(capability)&&(capability!=="speech-to-text"||r.runtimeModelId==="qwen3-asr-flash")&&await r.verifyDeploymentBinding();
    const p=c?.prices.find(p=>p.modelId===model.row.modelId&&p.modelProvider===r?.modelProvider&&p.runtimeModelId===r?.runtimeModelId),n=c?.nativePrices?.find(p=>p.modelId===model.row.modelId&&p.modelProvider===r?.modelProvider&&p.runtimeModelId===r?.runtimeModelId&&p.unit===(capability==="text-to-speech"?"character":capability==="speech-to-text"?"millisecond":"image"));
    if(capability==="speech-to-text"&&plan!=="enterprise")verified=false;
    verified=verified&&((capability==="image-generation"||capability==="text-to-speech"||capability==="speech-to-text")?!!n:!!r?.measureSerializedBody&&!!p&&(capability==="text"?"maxOutputTokens" in p:"billingMode" in p&&p.billingMode==="input-only"));
    result.push({modelId:model.row.modelId,displayName:model.row.displayName,capability,available:verified,reason:verified?null:capability==="speech-to-text"&&plan!=="enterprise"?"native-asr-token-bound-unverified":"trusted-adapter-price-or-bound-unavailable",modelProvider:verified?r!.modelProvider:null,runtimeModelId:verified?r!.runtimeModelId:null,currency:verified?c!.currency:null,maximumOutputTokens:verified&&p&&"maxOutputTokens" in p?p.maxOutputTokens:null,nativeUnit:verified&&n?n.unit:null,maximumQuantity:verified&&n?n.maxQuantity:null});
   }
  }return result;
 },readUsageProjection:(actor,id)=>deps.repo.readUsageProjection(actor,id)};
 return {service:new PlatformModelTestService({repository:deps.repo,adapters,accounting}),reader};
}
