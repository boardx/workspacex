import type {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import {preparePlatformTestCall,validatePlatformTestConfig,readPlatformTestJson,reportedPlatformTestTokens,unknownPlatformTestUsage,type PreparedPlatformTestCall,type PlatformTestClientHooks} from "./platform-test-vector-client";
export interface PlatformTestTextConfig {
 readonly endpoint:string;readonly apiKey:string;readonly runtimeModelId:string;readonly timeoutMs:number;
 /** Explicit verified deployment support; never inferred from a model/catalog name. */
 readonly outputCapKey:"max_tokens"|"max_completion_tokens";readonly maximumOutputTokens:number;
 readonly temperature:number;readonly systemPrompt:string;
}
/** OpenAI-compatible one-shot text only. Streaming, tools, audio and vision are unavailable here. */
export class PlatformTestTextClient {
 private readonly config:PlatformTestTextConfig;private readonly dispatched=new Set<string>();
 constructor(config:PlatformTestTextConfig){validatePlatformTestConfig(config);
  if(!["max_tokens","max_completion_tokens"].includes(config.outputCapKey)||!Number.isSafeInteger(config.maximumOutputTokens)||config.maximumOutputTokens<1||config.maximumOutputTokens>8192
   ||!Number.isFinite(config.temperature)||config.temperature<0||config.temperature>2||typeof config.systemPrompt!=="string"||config.systemPrompt.length>10000)throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");this.config={...config};}
 prepare(request:Extract<PlatformModelTestRequest,{capability:"text"}>):PreparedPlatformTestCall{
  if(request.capability!=="text"||!request.input.prompt.trim()||request.input.prompt.length>10000||!Number.isSafeInteger(request.bounds.maxOutputTokens)||request.bounds.maxOutputTokens<1||request.bounds.maxOutputTokens>this.config.maximumOutputTokens)throw new Error("PLATFORM_TEST_REQUEST_INVALID");
  return preparePlatformTestCall(request,this.config.runtimeModelId,{model:this.config.runtimeModelId,messages:[{role:"system",content:this.config.systemPrompt},{role:"user",content:request.input.prompt}],temperature:this.config.temperature,
   [this.config.outputCapKey]:request.bounds.maxOutputTokens,stream:false},this.config.timeoutMs);
 }
 async invoke(prepared:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,callerSignal?:AbortSignal):Promise<PlatformModelTestResult>{
  if(!hooks||typeof hooks.beforeDispatch!=="function"||typeof hooks.terminal!=="function")throw new Error("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
  if(prepared.capability!=="text"||prepared.runtimeModelId!==this.config.runtimeModelId)throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  const payload=JSON.parse(prepared.serializedBody) as Record<string,unknown>;
  if(payload.model!==this.config.runtimeModelId||payload[this.config.outputCapKey]!==prepared.bounds.maxOutputTokens||!prepared.bounds.maxOutputTokens||prepared.bounds.maxOutputTokens>this.config.maximumOutputTokens||payload.stream!==false||payload.temperature!==this.config.temperature)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");
  if(this.dispatched.has(prepared.physicalReceiptId))throw new Error("PLATFORM_TEST_REPLAY_NO_DISPATCH");
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(prepared.bounds.timeoutMs)]):AbortSignal.timeout(prepared.bounds.timeoutMs);signal.throwIfAborted();
  this.dispatched.add(prepared.physicalReceiptId);const startedAt=new Date().toISOString();await hooks.beforeDispatch(Object.freeze({...prepared,startedAt}));
  let outcome:"succeeded"|"failed"="failed",usage=unknownPlatformTestUsage();
  try{
   signal.throwIfAborted();const response=await fetch(this.config.endpoint,{method:"POST",signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json","accept-encoding":"identity"},body:prepared.serializedBody});
   const body=await readPlatformTestJson(response,signal);usage=reportedPlatformTestTokens(body.usage);
   if(!response.ok||body.error)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const choices=body.choices as Array<{message?:{content?:unknown;tool_calls?:unknown}}>;
   const text=choices?.[0]?.message?.content;
   if(!Array.isArray(choices)||choices.length!==1||typeof text!=="string"||text.length>65536||choices[0]?.message?.tool_calls)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   outcome="succeeded";return {kind:"text",text};
  }catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}
  finally{await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt,endedAt:new Date().toISOString(),outcome,usage});}
 }
}
