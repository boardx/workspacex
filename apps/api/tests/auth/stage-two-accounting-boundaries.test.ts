import {createHash} from "node:crypto";
import {prepareImageAiAdmission} from "../../src/infrastructure/agent-run/image-ai-admission";
import {describe,it,expect,vi} from "vitest";
import {withCommittedAiPolicyDecision} from "../../src/application/agent-run/committed-ai-policy-decision";
import {AiQuotaPolicyError} from "../../src/application/agent-run/ai-quota-policy-error";
import {executePricedModelCall} from "../../src/application/agent-run/execute-priced-model-call";
import {enrichLateUsage,type UsageFacts} from "../../src/domain/agent-run/late-usage-enrichment";
import {decideAiAdmission,priceAiTokens} from "../../src/domain/agent-run/ai-budget";
import {priceNativeAiUsage} from "../../src/domain/agent-run/ai-billable-unit";
import {NativeModelPrice,Configuration} from "@repo/contracts/ai-policy";
import {toOrgId} from "../../src/domain/org-id";

/** Independent bounded negatives. Pure/mocked evidence only: no PG serialization,
 * supplier signature validation, notification visibility or recovery completion. */
describe("stage two independent accounting boundaries",()=>{
 const org=toOrgId("stage-two-org");
 const zero:UsageFacts={tokens_total:0,total_source:"reported",tokens_prompt:0,tokens_completion:0,
  tokens_cache_input:0,tokens_reasoning_output:0,cost_micros:"0",currency:"CNY",price_version:"original",
  native_unit:null,native_quantity:null,native_source:null};
 it("caller revision-looking metadata cannot replace a known zero through ordinary enrichment",()=>{
  const replacement={...zero,tokens_total:1,tokens_prompt:1,cost_micros:"2",revision:"vendor-2",verified:1,evidence_digest:"a".repeat(64)};
  expect(()=>enrichLateUsage(zero,replacement)).toThrow("AI_USAGE_KNOWN_VALUE_CONFLICT");
  expect(zero).toMatchObject({tokens_total:0,cost_micros:"0",price_version:"original"});
 });
 it("ordinary late facts cannot switch original price or currency even without changing counters",()=>{
  for(const patch of [{price_version:"current"},{currency:"USD"}] as UsageFacts[])
   expect(()=>enrichLateUsage(zero,{...zero,...patch})).toThrow("AI_USAGE_PRICE_OR_UNIT_CONFLICT");
 });
 it("partial completion keeps the already known zero input and rejects a later conflicting subset",()=>{
  const partial={...zero,total_source:"unknown",tokens_completion:null,tokens_reasoning_output:null,cost_micros:null,currency:null,price_version:null};
  const complete=enrichLateUsage(partial,{...partial,total_source:"reported",tokens_total:2,tokens_completion:2})!;
  expect(complete).toMatchObject({tokens_prompt:0,tokens_completion:2,tokens_total:2,cost_micros:null});
  expect(()=>enrichLateUsage(complete,{...complete,tokens_cache_input:1})).toThrow("AI_USAGE_KNOWN_VALUE_CONFLICT");
 });
 it("a refusal-shaped untrusted error rolls back rather than committing tenant changes",async()=>{
  const effects:string[]=[];
  const db={withTenant:async(tenant:unknown,work:(s:never)=>Promise<unknown>)=>{
   expect(tenant).toBe(org);try{const value=await work({} as never);effects.push("commit");return value;}
   catch(error){effects.push("rollback");throw error;}
  }} as never;
  const forged=Object.assign(new Error("AI_LIMIT_RULE_BLOCKED"),{name:"AiQuotaPolicyError",decision:"AI_LIMIT_RULE_BLOCKED"});
  await expect(withCommittedAiPolicyDecision(db,org,async()=>{throw forged;})).rejects.toBe(forged);
  expect(effects).toEqual(["rollback"]);
 });
 it("real typed policy refusal commits before propagation and does not swallow the refusal",async()=>{
  const order:string[]=[];
  const db={withTenant:async(tenant:unknown,work:(s:never)=>Promise<unknown>)=>{
   expect(tenant).toBe(org);const value=await work({} as never);order.push("commit");return value;
  }} as never;
  const refusal=new AiQuotaPolicyError("AI_LIMIT_APPROVAL_REQUIRED");
  await withCommittedAiPolicyDecision(db,org,async()=>{order.push("decision");throw refusal;}).catch(error=>{expect(error).toBe(refusal);order.push("refused");});
  expect(order).toEqual(["decision","commit","refused"]);
 });
 it("pre-cancelled work cannot read policy, reserve or call a model despite a quota-looking reason",async()=>{
  const controller=new AbortController();controller.abort(new AiQuotaPolicyError("AI_TOKEN_DEGRADE_REQUIRED"));
  const policy={resolveBudgetPolicy:vi.fn()},admission={reserve:vi.fn(),settle:vi.fn()},model={complete:vi.fn()};
  await expect(executePricedModelCall({} as never,{system:"s",user:"u",signal:controller.signal},{policy,admission,model} as never)).rejects.toThrow("AI_CALL_CANCELLED");
  expect(policy.resolveBudgetPolicy).not.toHaveBeenCalled();expect(admission.reserve).not.toHaveBeenCalled();expect(model.complete).not.toHaveBeenCalled();
 });
 it("enterprise Token exemption cannot free held money or assume an unpriced cache is free",()=>{
  const state={plan:"enterprise" as const,tokenLimit:0n,costLimitMicros:5n,usedTokens:999n,heldTokens:999n,usedCostMicros:3n,heldCostMicros:2n};
  expect(decideAiAdmission(state,100n,1n)).toBe("COST_LIMIT_REACHED");
  expect(()=>priceAiTokens({version:"original",currency:"CNY",inputMicrosPerMillion:1n,outputMicrosPerMillion:1n},
   {input:2n,output:0n,cachedInput:1n})).toThrow("AI_CACHE_PRICE_UNCONFIGURED");
 });
});


describe("stage two native independent pricing negatives",()=>{
 const tariff={unit:"millisecond" as const,quantum:1000n,microsPerQuantum:7n,currency:"CNY",version:"original"};
 it("unknown or estimated elapsed audio never turns into reported money or manufactured Tokens",()=>{
  expect(priceNativeAiUsage(tariff,{kind:"native",unit:"millisecond",quantity:null,source:"unknown"})).toBeNull();
  expect(priceNativeAiUsage(tariff,{kind:"native",unit:"millisecond",quantity:1001n,source:"estimated"})).toBeNull();
  expect(priceNativeAiUsage(tariff,{kind:"native",unit:"millisecond",quantity:1001n,source:"reported"})).toBe(8n);
  expect(()=>priceNativeAiUsage(tariff,{kind:"native",unit:"image",quantity:1n,source:"reported"})).toThrow("INVALID_AI_NATIVE_PRICE_OR_USAGE");
 });
 it("ordinary native request needs no Token allowance but shares the same finite held money",()=>{
  const state={plan:"ordinary" as const,tokenLimit:null,costLimitMicros:10n,usedTokens:100n,heldTokens:100n,usedCostMicros:2n,heldCostMicros:0n};
  expect(decideAiAdmission(state,0n,8n,"not-applicable")).toBe("allowed");
  expect(decideAiAdmission({...state,heldCostMicros:1n},0n,8n,"not-applicable")).toBe("COST_LIMIT_REACHED");
  expect(()=>decideAiAdmission(state,1n,8n,"not-applicable")).toThrow("INVALID_AI_NATIVE_TOKEN_BOUND");
  expect(decideAiAdmission(state,0n,8n)).toBe("TOKEN_LIMIT_UNCONFIGURED");
 });
 it("strict native tariff cannot accept Token caps or nonpositive billing bounds",()=>{
  const configured={modelId:"audio",modelProvider:"provider",runtimeModelId:"vendor-audio",unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"2000"};
  expect(NativeModelPrice.safeParse(configured).success).toBe(true);
  for(const extra of [{maxOutputTokens:1},{inputMicrosPerMillion:"1"},{quantum:"0"},{maxQuantity:"0"}])
   expect(NativeModelPrice.safeParse({...configured,...extra}).success).toBe(false);
 });
});


describe("stage two native image dispatch binding negatives",()=>{
 const org=toOrgId("stage-two-image");
 const context={orgId:org,parentRunId:"root",attemptId:"root:1",leaseEpoch:1,bindingId:"native",toolCallId:"tool"};
 const request={requestId:"physical-image",modelProvider:"provider",modelId:"image-model",serializedBody:JSON.stringify({model:"image-model",prompt:"fixture",n:1}),quantity:1n};
 for(const changed of ["tenant","body","epoch"] as const)it(`a claimed verified binding with wrong ${changed} cannot reserve or persist start`,async()=>{
  const admission={reserve:vi.fn(),settle:vi.fn()},usage={startRequest:vi.fn(),record:vi.fn()};
  const resolved={orgId:org,userId:"owner",runId:"root",sourceRunId:"root",subtaskId:null,executionAttemptId:"root:1",executionLeaseEpoch:1,
   projectId:null,threadId:null,agentId:null,formalModelId:"formal",logicalCallId:"logical",
   windowStart:"2026-10-01T00:00:00Z",windowEnd:"2026-11-01T00:00:00Z",modelProvider:"provider",modelId:"image-model",
   serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex"),maximumQuantity:1n,
   price:{unit:"image" as const,quantum:1n,microsPerQuantum:1n,currency:"CNY",version:"original"},tokenBilling:"not-applicable" as const,bindingVerified:true as const};
  if(changed==="tenant")resolved.orgId=toOrgId("foreign");
  if(changed==="body")resolved.serializedBodySha256="0".repeat(64);
  if(changed==="epoch")resolved.executionLeaseEpoch=2;
  await expect(prepareImageAiAdmission({admission,usage,resolve:async()=>resolved}).start(context,request)).rejects.toThrow("AI_IMAGE_BOUND_UNVERIFIED");
  expect(admission.reserve).not.toHaveBeenCalled();expect(usage.startRequest).not.toHaveBeenCalled();expect(usage.record).not.toHaveBeenCalled();
 });
});


describe("stage two native tariff API malformed numeric inputs",()=>{
 const native={modelId:"audio",modelProvider:"provider",runtimeModelId:"vendor-audio",unit:"millisecond",quantum:"1000",microsPerQuantum:"7",maxQuantity:"2000"};
 const configuration={window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"UTC"},ordinaryTokensPerUser:null,costMicrosPerUser:"100",currency:"CNY",
  prices:[{modelId:"chat",modelProvider:"provider",runtimeModelId:"vendor-chat",maxInputTokens:10,maxOutputTokens:2,inputMicrosPerMillion:"1",outputMicrosPerMillion:"1",cachedInputMicrosPerMillion:"1"}],
  nativePrices:[native],fallbackModelIds:[],maxAttempts:1};
 it("the baseline full policy is valid",()=>{expect(Configuration.safeParse(configuration).success).toBe(true);});
 for(const field of ["quantum","microsPerQuantum","maxQuantity"] as const)
  for(const value of ["1.5","not-a-number","","0","9223372036854775808"])
   it(`${field}=${JSON.stringify(value)} is rejected without throwing at either API schema`,()=>{
    const changed={...native,[field]:value};
    expect(()=>NativeModelPrice.safeParse(changed)).not.toThrow();
    expect(NativeModelPrice.safeParse(changed).success).toBe(false);
    expect(()=>Configuration.safeParse({...configuration,nativePrices:[changed]})).not.toThrow();
    expect(Configuration.safeParse({...configuration,nativePrices:[changed]}).success).toBe(false);
   });
});
