import {PlatformModelTestRequest,type PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import {encodePlatformTestPcm16Wav} from "./platform-test-speech-client";
import {preparePlatformTestCall,validatePlatformTestConfig,readPlatformTestJson,unknownPlatformTestUsage,type PreparedPlatformTestCall,type PlatformTestClientHooks,type PlatformTestReportedUsage} from "./platform-test-vector-client";
export interface PlatformTestAsrConfig {
 readonly endpoint:string;readonly apiKey:string;readonly runtimeModelId:"qwen3-asr-flash";
 readonly protocol:"qwen-asr-dashscope";readonly maximumAudioMilliseconds:number;readonly timeoutMs:number;
}
/** One synchronous DashScope Qwen3-ASR-Flash request, canonical inline WAV only.
 * Official protocol: https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference (2026-10-05).
 * PCM duration bounds preparation only; settlement uses supplier-reported seconds, never PCM length.
 */
export class PlatformTestAsrClient {
 private readonly config:PlatformTestAsrConfig;private readonly prepared=new WeakSet<PreparedPlatformTestCall>();private readonly dispatched=new Set<string>();
 constructor(config:PlatformTestAsrConfig){
  validatePlatformTestConfig(config);
  if(config.protocol!=="qwen-asr-dashscope"||config.runtimeModelId!=="qwen3-asr-flash"||!Number.isSafeInteger(config.maximumAudioMilliseconds)||config.maximumAudioMilliseconds<1||config.maximumAudioMilliseconds>60_000)throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  this.config={...config};
 }
 prepare(request:Extract<PlatformModelTestRequest,{capability:"speech-to-text"}>):PreparedPlatformTestCall {
  const parsed=PlatformModelTestRequest.safeParse(request);if(!parsed.success||parsed.data.capability!=="speech-to-text")throw new Error("PLATFORM_TEST_REQUEST_INVALID");
  const valid=parsed.data,quantity=BigInt(valid.bounds.maximumQuantity);
  if(quantity>BigInt(this.config.maximumAudioMilliseconds))throw new Error("PLATFORM_TEST_AUDIO_BOUND_EXCEEDED");
  const audio=encodePlatformTestPcm16Wav(valid.input,Number(quantity));
  // Official billable seconds are integers: reserve a whole-second ceiling, not just PCM milliseconds.
  if(BigInt(Math.ceil(audio.boundedDurationMs/1000))*1000n>quantity)throw new Error("PLATFORM_TEST_AUDIO_BOUND_EXCEEDED");
  const body={model:this.config.runtimeModelId,input:{messages:[{role:"user",content:[{audio:`data:audio/wav;base64,${audio.wav.toString("base64")}`}]}]}};
  const call=preparePlatformTestCall(valid,this.config.runtimeModelId,body,this.config.timeoutMs);
  this.prepared.add(call);return call;
 }
 async invoke(call:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,callerSignal?:AbortSignal):Promise<PlatformModelTestResult>{
  if(!hooks||typeof hooks.beforeDispatch!=="function"||typeof hooks.terminal!=="function")throw new Error("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
  if(!this.prepared.has(call)||call.capability!=="speech-to-text"||call.runtimeModelId!==this.config.runtimeModelId)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");
  if(this.dispatched.has(call.physicalReceiptId))throw new Error("PLATFORM_TEST_REPLAY_NO_DISPATCH");
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(call.bounds.timeoutMs)]):AbortSignal.timeout(call.bounds.timeoutMs);signal.throwIfAborted();
  this.dispatched.add(call.physicalReceiptId);const startedAt=new Date().toISOString();await hooks.beforeDispatch(Object.freeze({...call,startedAt}));
  let usage:PlatformTestReportedUsage={...unknownPlatformTestUsage(),nativeUnit:"millisecond"},outcome:"succeeded"|"failed"="failed";
  try{
   signal.throwIfAborted();const response=await fetch(this.config.endpoint,{method:"POST",signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json","accept-encoding":"identity"},body:call.serializedBody});
   const body=await readPlatformTestJson(response,signal),raw=body.usage;
   if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    const counters=raw as Record<string,unknown>,seconds=counters.seconds,details=counters.output_tokens_details;
    const output=details&&typeof details==="object"&&!Array.isArray(details)?(details as Record<string,unknown>).text_tokens:undefined;
    usage={...usage,nativeQuantity:typeof seconds==="number"&&Number.isSafeInteger(seconds)&&seconds>=0?BigInt(seconds)*1000n:null,outputTokens:typeof output==="number"&&Number.isSafeInteger(output)&&output>=0?output:null};
   }
   if(!response.ok||body.code||(body.status_code!==undefined&&body.status_code!==200))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const choices=(body.output as {choices?:unknown}|undefined)?.choices;
   if(!Array.isArray(choices)||choices.length!==1)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const choice=choices[0] as {finish_reason?:unknown;message?:{role?:unknown;content?:unknown}};
   if(choice.finish_reason!=="stop"||choice.message?.role!=="assistant"||!Array.isArray(choice.message.content)||!choice.message.content.length)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const parts=choice.message.content as {text?:unknown}[];
   if(parts.some(part=>!part||typeof part.text!=="string"))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const text=parts.map(part=>part.text as string).join("");
   if(!text.trim()||text.length>100_000||(usage.nativeQuantity!==null&&usage.nativeQuantity>BigInt(call.bounds.maximumQuantity!)))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   outcome="succeeded";return {kind:"text",text};
  }catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}
  finally{await hooks.terminal({physicalReceiptId:call.physicalReceiptId,startedAt,endedAt:new Date().toISOString(),outcome,usage});}
 }
}
