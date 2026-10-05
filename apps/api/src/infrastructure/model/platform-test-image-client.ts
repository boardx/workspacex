import {setTimeout as delay} from "node:timers/promises";
import type {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import {preparePlatformTestCall,validatePlatformTestConfig,readPlatformTestJson,unknownPlatformTestUsage,type PreparedPlatformTestCall,type PlatformTestClientHooks} from "./platform-test-vector-client";
export interface PlatformTestImageConfig {
 readonly endpoint:string;readonly apiKey:string;readonly runtimeModelId:string;readonly protocol:"wanx-async";
 readonly maximumQuantity:bigint;readonly timeoutMs:number;readonly pollIntervalMs:number;readonly maxPolls:number;
}
/** One paid asynchronous submission. Task polling never creates another generation. */
export class PlatformTestImageClient {
 private readonly config:PlatformTestImageConfig;private readonly dispatched=new Set<string>();
 constructor(config:PlatformTestImageConfig){validatePlatformTestConfig(config);
  if(config.protocol!=="wanx-async"||config.maximumQuantity<1n||config.maximumQuantity>4n||!Number.isSafeInteger(config.pollIntervalMs)||config.pollIntervalMs<1||!Number.isSafeInteger(config.maxPolls)||config.maxPolls<1||config.maxPolls>100)throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");this.config={...config};}
 prepare(request:Extract<PlatformModelTestRequest,{capability:"image-generation"}>):PreparedPlatformTestCall{
  if(request.capability!=="image-generation"||typeof request.input.prompt!=="string"||!request.input.prompt.trim()||request.input.prompt.length>4000||!/^[1-4]$/.test(request.bounds.maximumQuantity)||BigInt(request.bounds.maximumQuantity)>this.config.maximumQuantity)throw new Error("PLATFORM_TEST_REQUEST_INVALID");
  return preparePlatformTestCall(request,this.config.runtimeModelId,{model:this.config.runtimeModelId,input:{prompt:request.input.prompt},parameters:{size:"1024*1024",n:Number(request.bounds.maximumQuantity)}},this.config.timeoutMs);
 }
 async invoke(prepared:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,callerSignal?:AbortSignal):Promise<PlatformModelTestResult>{
  if(!hooks||typeof hooks.beforeDispatch!=="function"||typeof hooks.terminal!=="function")throw new Error("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
  if(prepared.capability!=="image-generation"||prepared.runtimeModelId!==this.config.runtimeModelId)throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  const payload=JSON.parse(prepared.serializedBody) as {model?:unknown;parameters?:{n?:unknown}};
  if(payload.model!==this.config.runtimeModelId||payload.parameters?.n!==Number(prepared.bounds.maximumQuantity)||!prepared.bounds.maximumQuantity||!/^[1-4]$/.test(prepared.bounds.maximumQuantity)||BigInt(prepared.bounds.maximumQuantity)>this.config.maximumQuantity)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");
  if(this.dispatched.has(prepared.physicalReceiptId))throw new Error("PLATFORM_TEST_REPLAY_NO_DISPATCH");
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(prepared.bounds.timeoutMs)]):AbortSignal.timeout(prepared.bounds.timeoutMs);signal.throwIfAborted();
  this.dispatched.add(prepared.physicalReceiptId);const startedAt=new Date().toISOString();await hooks.beforeDispatch(Object.freeze({...prepared,startedAt}));
  let usage={...unknownPlatformTestUsage(),nativeUnit:"image" as const},outcome:"succeeded"|"failed"="failed";
  try{
   signal.throwIfAborted();const response=await fetch(this.config.endpoint,{method:"POST",signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json","accept-encoding":"identity","X-DashScope-Async":"enable"},body:prepared.serializedBody});
   const submitted=await readPlatformTestJson(response,signal),task=(submitted.output as {task_id?:unknown})?.task_id;
   if(!response.ok||submitted.code||typeof task!=="string"||!/^[A-Za-z0-9_-]{1,256}$/.test(task))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const url=new URL(`/api/v1/tasks/${task}`,this.config.endpoint);
   for(let poll=0;poll<this.config.maxPolls;poll++){
    signal.throwIfAborted();const response=await fetch(url,{signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"accept-encoding":"identity"}});
    const body=await readPlatformTestJson(response,signal),output=body.output as {task_status?:unknown;results?:Array<{url?:unknown}>}|undefined;
    const reported=(body.usage as {image_count?:unknown})?.image_count;
    if(output?.task_status!=="PENDING"&&output?.task_status!=="RUNNING")usage={...usage,nativeQuantity:typeof reported==="number"&&Number.isSafeInteger(reported)&&reported>=0?BigInt(reported):null};
    if(!response.ok||body.code)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
    if(output?.task_status==="PENDING"||output?.task_status==="RUNNING"){await delay(this.config.pollIntervalMs,undefined,{signal});continue;}
    if(usage.nativeQuantity!==null&&usage.nativeQuantity>BigInt(prepared.bounds.maximumQuantity!))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
    if(output?.task_status!=="SUCCEEDED"||!Array.isArray(output.results)||!output.results.length||output.results.length>Number(prepared.bounds.maximumQuantity))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
    const assets=output.results.map(result=>{if(typeof result.url!=="string"||result.url.length>2000)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");let parsed:URL;try{parsed=new URL(result.url);}catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");return {url:result.url,mimeType:"image/png"};});
    outcome="succeeded";return {kind:"image",assets};
   }
   throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
  }catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}
  finally{await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt,endedAt:new Date().toISOString(),outcome,usage});}
 }
}
