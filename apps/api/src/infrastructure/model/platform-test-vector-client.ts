import type {AiNativeUnit} from "../../domain/agent-run/ai-billable-unit";
import type {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
export interface PreparedPlatformTestCall {
 readonly physicalReceiptId:string;readonly serializedBody:string;readonly runtimeModelId:string;
 readonly capability:"text"|"image-generation"|"embedding"|"rerank"|"text-to-speech"|"speech-to-text";
 readonly bounds:{readonly maximumCostMicros:string;readonly timeoutMs:number;readonly maximumQuantity?:string;readonly maxOutputTokens?:number};
}
export interface PlatformTestReportedUsage {
 readonly tokensTotal:number|null;readonly inputTokens:number|null;readonly outputTokens:number|null;
 readonly nativeUnit:AiNativeUnit|null;readonly nativeQuantity:bigint|null;
 readonly cacheInputTokens?:number|null;readonly reasoningOutputTokens?:number|null;
}
export interface PlatformTestClientHooks {
 beforeDispatch(call:PreparedPlatformTestCall&{readonly startedAt:string}):Promise<void>;
 terminal(event:{readonly physicalReceiptId:string;readonly startedAt:string;readonly endedAt:string;readonly outcome:"succeeded"|"failed";readonly usage:PlatformTestReportedUsage}):Promise<void>;
}
export interface PlatformTestVectorConfig {
 readonly endpoint:string;readonly apiKey:string;readonly runtimeModelId:string;readonly timeoutMs:number;
 readonly protocol:"openai-embedding"|"dashscope-embedding"|"dashscope-rerank"|"qwen3-rerank";
}
export function validatePlatformTestConfig(config:{endpoint:string;apiKey:string;runtimeModelId:string;timeoutMs:number}):void {
 let endpoint:URL;try{endpoint=new URL(config.endpoint);}catch{throw new Error("PLATFORM_TEST_BINDING_UNAVAILABLE");}
 if(!config.apiKey||!config.runtimeModelId||config.runtimeModelId.length>200||endpoint.username||endpoint.password
  ||(endpoint.protocol!=="https:"&&!(endpoint.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname)))
  ||!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<1||config.timeoutMs>60_000)throw new Error("PLATFORM_TEST_BINDING_UNAVAILABLE");
}
export function preparePlatformTestCall(request:PlatformModelTestRequest,runtimeModelId:string,body:unknown,timeoutMs:number):PreparedPlatformTestCall {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.testId)
  ||!/^[1-9][0-9]*$/.test(request.bounds.maximumCostMicros)||BigInt(request.bounds.maximumCostMicros)>9223372036854775807n
  ||!Number.isSafeInteger(request.bounds.timeoutMs)||request.bounds.timeoutMs<1||request.bounds.timeoutMs>60_000)
  throw new Error("PLATFORM_TEST_REQUEST_INVALID");
 const serializedBody=JSON.stringify(body),maximumBodyBytes=request.capability==="speech-to-text"?4*1024*1024:100_000;
 if(Buffer.byteLength(serializedBody)>maximumBodyBytes)throw new Error("PLATFORM_TEST_REQUEST_TOO_LARGE");
 return Object.freeze({physicalReceiptId:request.testId,serializedBody,runtimeModelId,capability:request.capability as PreparedPlatformTestCall["capability"],
  bounds:Object.freeze({maximumCostMicros:request.bounds.maximumCostMicros,timeoutMs:Math.min(timeoutMs,request.bounds.timeoutMs),
   ...("maximumQuantity" in request.bounds?{maximumQuantity:request.bounds.maximumQuantity}:{}),
   ...("maxOutputTokens" in request.bounds?{maxOutputTokens:request.bounds.maxOutputTokens}:{})})});
}
export const unknownPlatformTestUsage=():PlatformTestReportedUsage=>({tokensTotal:null,inputTokens:null,outputTokens:null,nativeUnit:null,nativeQuantity:null});
export function reportedPlatformTestTokens(raw:unknown):PlatformTestReportedUsage {
 const usage=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const count=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:null;
 const inputTokens=count(usage.prompt_tokens??usage.input_tokens),outputTokens=count(usage.completion_tokens??usage.output_tokens);
 const promptDetails=usage.prompt_tokens_details as Record<string,unknown>|undefined,completionDetails=usage.completion_tokens_details as Record<string,unknown>|undefined;
 const cached=count(promptDetails?.cached_tokens),reasoning=count(completionDetails?.reasoning_tokens);
 return {tokensTotal:count(usage.total_tokens),inputTokens,outputTokens,nativeUnit:null,nativeQuantity:null,
  cacheInputTokens:cached!==null&&inputTokens!==null&&cached<=inputTokens?cached:null,reasoningOutputTokens:reasoning!==null&&outputTokens!==null&&reasoning<=outputTokens?reasoning:null};
}
export function abortablePlatformTest<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(new Error("PLATFORM_TEST_CANCELLED"));
 return new Promise((resolve,reject)=>{const abort=()=>reject(new Error("PLATFORM_TEST_CANCELLED"));signal.addEventListener("abort",abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));});
}
export async function readPlatformTestJson(response:Response,signal:AbortSignal):Promise<Record<string,unknown>> {
 if(!response.body)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
 if(response.headers.get("content-encoding")&&!['identity'].includes(response.headers.get("content-encoding")!))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const next=await abortablePlatformTest(reader.read(),signal);if(next.done)break;bytes+=next.value.length;if(bytes>2_000_000)throw new Error("PLATFORM_TEST_RESPONSE_TOO_LARGE");chunks.push(next.value);}
  const body:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");return body as Record<string,unknown>;
 }finally{void reader.cancel().catch(()=>{});}
}
/** Fixed server endpoint/credential, exact prepared bytes, one physical paid request. */
export class PlatformTestVectorClient {
 private readonly config:PlatformTestVectorConfig;private readonly dispatched=new Set<string>();
 constructor(config:PlatformTestVectorConfig){validatePlatformTestConfig(config);this.config={...config};}
 prepare(request:Extract<PlatformModelTestRequest,{capability:"embedding"|"rerank"}>):PreparedPlatformTestCall {
  const {protocol,runtimeModelId}=this.config;
  if(request.capability==="embedding"){
   if(!['openai-embedding','dashscope-embedding'].includes(protocol))throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
   if(!Array.isArray(request.input.texts)||request.input.texts.length<1||request.input.texts.length>8||request.input.texts.some(x=>typeof x!=="string"||!x||x.length>2000))throw new Error("PLATFORM_TEST_REQUEST_INVALID");
   return preparePlatformTestCall(request,runtimeModelId,protocol==="openai-embedding"?{model:runtimeModelId,input:request.input.texts,encoding_format:"float"}:{model:runtimeModelId,input:{texts:request.input.texts},parameters:{text_type:"document"}},this.config.timeoutMs);
  }
  if(!['dashscope-rerank','qwen3-rerank'].includes(protocol))throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  if(!request.input.query||request.input.query.length>2000||!Array.isArray(request.input.documents)||request.input.documents.length<1||request.input.documents.length>20||request.input.documents.some(x=>typeof x!=="string"||!x||x.length>2000))throw new Error("PLATFORM_TEST_REQUEST_INVALID");
  const payload=protocol==="qwen3-rerank"?{model:runtimeModelId,query:request.input.query,documents:request.input.documents,top_n:request.input.documents.length}
   :{model:runtimeModelId,input:{query:request.input.query,documents:request.input.documents},parameters:{top_n:request.input.documents.length,return_documents:false}};
  return preparePlatformTestCall(request,runtimeModelId,payload,this.config.timeoutMs);
 }
 async invoke(prepared:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,callerSignal?:AbortSignal):Promise<PlatformModelTestResult>{
  if(!hooks||typeof hooks.beforeDispatch!=="function"||typeof hooks.terminal!=="function")throw new Error("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
  if(prepared.runtimeModelId!==this.config.runtimeModelId||!['embedding','rerank'].includes(prepared.capability)
   ||(prepared.capability==="embedding"?!["openai-embedding","dashscope-embedding"].includes(this.config.protocol):!["dashscope-rerank","qwen3-rerank"].includes(this.config.protocol)))throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  const payload=JSON.parse(prepared.serializedBody) as Record<string,unknown>;if(payload.model!==this.config.runtimeModelId)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");
  if(this.dispatched.has(prepared.physicalReceiptId))throw new Error("PLATFORM_TEST_REPLAY_NO_DISPATCH");
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(prepared.bounds.timeoutMs)]):AbortSignal.timeout(prepared.bounds.timeoutMs);signal.throwIfAborted();
  this.dispatched.add(prepared.physicalReceiptId);const startedAt=new Date().toISOString();await hooks.beforeDispatch(Object.freeze({...prepared,startedAt}));
  let outcome:"succeeded"|"failed"="failed",usage=unknownPlatformTestUsage();
  try{
   signal.throwIfAborted();const response=await fetch(this.config.endpoint,{method:"POST",signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json","accept-encoding":"identity"},body:prepared.serializedBody});
   const body=await readPlatformTestJson(response,signal);usage=reportedPlatformTestTokens(body.usage);
   if(!response.ok||body.code)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const result=this.result(prepared,payload,body);outcome="succeeded";return result;
  }catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}
  finally{await hooks.terminal({physicalReceiptId:prepared.physicalReceiptId,startedAt,endedAt:new Date().toISOString(),outcome,usage});}
 }
 private result(prepared:PreparedPlatformTestCall,payload:Record<string,unknown>,body:Record<string,unknown>):PlatformModelTestResult{
  const output=body.output as Record<string,unknown>|undefined;
  if(prepared.capability==="embedding"){
   const rows=(this.config.protocol==="openai-embedding"?body.data:output?.embeddings) as Array<Record<string,unknown>>|undefined;
   const input=this.config.protocol==="openai-embedding"?payload.input:(payload.input as Record<string,unknown>)?.texts;
   if(!Array.isArray(rows)||!Array.isArray(input)||rows.length!==input.length||rows.length<1||rows.length>8)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const ordered=rows.slice().sort((a,b)=>Number(a.index??a.text_index)-Number(b.index??b.text_index));let dimensions=0;
   for(let i=0;i<ordered.length;i++){const row=ordered[i]!,vector=row.embedding;if((row.index??row.text_index)!==i||!Array.isArray(vector)||!vector.length||vector.length>16384||vector.some(x=>typeof x!=="number"||!Number.isFinite(x))||(dimensions&&vector.length!==dimensions))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");dimensions=vector.length;}
   return {kind:"embedding",vectorCount:ordered.length,dimensions,preview:(ordered[0]!.embedding as number[]).slice(0,16)};
  }
  const rows=(this.config.protocol==="qwen3-rerank"?body.results:output?.results) as Array<Record<string,unknown>>|undefined;
  const documents=this.config.protocol==="qwen3-rerank"?payload.documents:(payload.input as Record<string,unknown>)?.documents;
  if(!Array.isArray(rows)||!Array.isArray(documents)||rows.length>documents.length)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
  const indexes=new Set<number>();const results=rows.map(row=>{const index=row.index,score=row.relevance_score;if(typeof index!=="number"||!Number.isInteger(index)||index<0||index>=documents.length||indexes.has(index)||typeof score!=="number"||!Number.isFinite(score)||score<0||score>1)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");indexes.add(index);return {index,score};});
  return {kind:"rerank",results};
 }
}
