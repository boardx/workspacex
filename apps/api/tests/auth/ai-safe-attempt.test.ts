import {describe,it,expect} from "vitest";
import {Configuration} from "@repo/contracts/ai-policy";
import {prepareAiAttempt,type VerifiedAiBinding,type VerifiedInputBound,type AiPoolCandidate} from "../../src/domain/agent-run/ai-safe-attempt";
const price=(id:string)=>({modelId:id,modelProvider:"fixture-route",runtimeModelId:`runtime-${id}`,inputMicrosPerMillion:"1000000",outputMicrosPerMillion:"2000000",cachedInputMicrosPerMillion:"3000000",maxInputTokens:100,maxOutputTokens:10});
const configuration=Configuration.parse({window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"1000",costMicrosPerUser:"10000",currency:"CNY",prices:[price("primary"),price("fallback")],fallbackModelIds:["fallback"],maxAttempts:2});
const row=(id:string):AiPoolCandidate=>({modelId:id,status:"已启用",kind:"self-hosted",shape:"single",complianceAttrs:[],members:[],contextWindow:1000,capabilityTags:["fixture-tool"]});
const binding=(id:string):VerifiedAiBinding=>({modelId:id,modelProvider:"fixture-route",runtimeModelId:`runtime-${id}`,capabilityTags:["fixture-tool"],contextWindow:1000,maxOutputTokens:100,outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true});
const measured=(id:string):VerifiedInputBound=>({modelProvider:"fixture-route",runtimeModelId:`runtime-${id}`,tokens:20,implementation:"fixture verified counter",version:"fixture-v1",source:"provider-count"});
const base={configuration,priceVersion:"immutable-fixture-v1",primaryModelId:"primary",attempt:0,confidentiality:"non-confidential" as const,requiredCapabilities:["fixture-tool"],pool:[row("primary"),row("fallback")],bindings:[binding("primary"),binding("fallback")],measuredInput:measured("primary")};
describe("safe per-attempt caps and authorized bounded fallback",()=>{
 it("reserves input+all output and the most expensive cache rate without double-counting",()=>{
  expect(prepareAiAttempt(base)).toMatchObject({decision:"allowed",modelId:"primary",runtimeModelId:"runtime-primary",maxOutputTokens:10,maximumTokens:30n,maximumCostMicros:80n});
 });
 it("fallback uses only ordered approved candidates and requires fresh matching tokenizer attribution",()=>{
  expect(prepareAiAttempt({...base,attempt:1})).toEqual({decision:"AI_INPUT_BOUND_UNVERIFIED"});
  expect(prepareAiAttempt({...base,attempt:1,measuredInput:measured("fallback")})).toMatchObject({decision:"allowed",modelId:"fallback"});
  expect(prepareAiAttempt({...base,attempt:2})).toEqual({decision:"AI_ATTEMPTS_EXHAUSTED"});
  expect(prepareAiAttempt({...base,configuration:{...configuration,fallbackModelIds:[],maxAttempts:1},attempt:1})).toEqual({decision:"AI_ATTEMPTS_EXHAUSTED"});
 });
 it("unknown/revoked route/model/capacity/accounting cannot reach dispatch",()=>{
  expect(prepareAiAttempt({...base,configuration:null})).toEqual({decision:"AI_POLICY_UNCONFIGURED"});
  expect(prepareAiAttempt({...base,pool:[]})).toEqual({decision:"AI_MODEL_UNAVAILABLE"});
  expect(prepareAiAttempt({...base,pool:[{...row("primary"),status:"已停用"}]})).toEqual({decision:"AI_MODEL_UNAVAILABLE"});
  expect(prepareAiAttempt({...base,pool:[{...row("primary"),contextWindow:100}]})).toEqual({decision:"AI_MODEL_CAPABILITY_UNVERIFIED"});
  expect(prepareAiAttempt({...base,pool:[{...row("primary"),capabilityTags:[]}]})).toEqual({decision:"AI_MODEL_CAPABILITY_UNVERIFIED"});
  for(const patch of [{accountingComplete:false},{outputCapSupported:false},{billedOutputBoundVerified:false},{contextWindow:100},{maxOutputTokens:1},{capabilityTags:[]}])
   expect(prepareAiAttempt({...base,bindings:[{...binding("primary"),...patch}]})).toEqual({decision:"AI_MODEL_CAPABILITY_UNVERIFIED"});
 });
 it("unknown confidentiality and closed-api fallback cannot leak confidential input",()=>{
  expect(prepareAiAttempt({...base,confidentiality:"unknown"})).toMatchObject({decision:"allowed",modelId:"primary"});
  expect(prepareAiAttempt({...base,confidentiality:"unknown",pool:[{...row("primary"),kind:"closed-api"}]})).toEqual({decision:"AI_MODEL_UNAVAILABLE"});
  expect(prepareAiAttempt({...base,confidentiality:"unknown",attempt:1,measuredInput:measured("fallback")})).toEqual({decision:"AI_MODEL_UNAVAILABLE"});
  expect(prepareAiAttempt({...base,confidentiality:"confidential",attempt:1,pool:[row("primary"),{...row("fallback"),kind:"closed-api"}],measuredInput:measured("fallback")})).toEqual({decision:"AI_MODEL_UNAVAILABLE"});
 });
 it("missing/malformed/too-large input bounds and unrepresentable monetary holds fail closed",()=>{
  for(const measuredInput of [null,{...measured("primary"),version:""},{...measured("primary"),tokens:1.5}])
   expect(prepareAiAttempt({...base,measuredInput})).toEqual({decision:"AI_INPUT_BOUND_UNVERIFIED"});
  expect(prepareAiAttempt({...base,measuredInput:{...measured("primary"),tokens:101}})).toEqual({decision:"AI_INPUT_LIMIT_REACHED"});
  const huge={...configuration,prices:[{...price("primary"),inputMicrosPerMillion:"9223372036854775807",cachedInputMicrosPerMillion:"9223372036854775807",maxInputTokens:2147483000,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1};
  expect(prepareAiAttempt({...base,configuration:huge,pool:[{...row("primary"),contextWindow:2147483647}],measuredInput:{...measured("primary"),tokens:2147483000},bindings:[{...binding("primary"),contextWindow:2147483647}]})).toEqual({decision:"AI_MAXIMUM_COST_UNREPRESENTABLE"});
 });
});
