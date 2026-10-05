import {PlatformModelTestRequest,type PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import {prepareQwenTtsRequest} from "../recording/qwen-tts-specification";
import {preparePlatformTestCall,validatePlatformTestConfig,readPlatformTestJson,unknownPlatformTestUsage,type PreparedPlatformTestCall,type PlatformTestClientHooks,type PlatformTestReportedUsage} from "./platform-test-vector-client";
export interface PlatformTestSpeechConfig {
 readonly endpoint:string;readonly apiKey:string;readonly runtimeModelId:"qwen3-tts-flash";
 readonly protocol:"qwen-tts-character";readonly allowedVoices:readonly string[];
 readonly maximumCharacters:bigint;readonly maximumUtf8Bytes:number;readonly timeoutMs:number;
}
/** Verified non-streaming Qwen3-TTS-Flash dialect. No implicit model family or pricing inference.
 * Source: https://help.aliyun.com/zh/model-studio/qwen-tts-api (observed 2026-10-05).
 * Character usage, never the documented placeholder input/output Token zeros.
 */
export class PlatformTestSpeechClient {
 private readonly config:PlatformTestSpeechConfig;private readonly prepared=new WeakSet<PreparedPlatformTestCall>();private readonly dispatched=new Set<string>();
 constructor(config:PlatformTestSpeechConfig){
  validatePlatformTestConfig(config);
  if(config.protocol!=="qwen-tts-character"||config.runtimeModelId!=="qwen3-tts-flash"||typeof config.maximumCharacters!=="bigint"||config.maximumCharacters<1n||config.maximumCharacters>600n
   ||!Number.isSafeInteger(config.maximumUtf8Bytes)||config.maximumUtf8Bytes<1||config.maximumUtf8Bytes>100_000
   ||!Array.isArray(config.allowedVoices)||!config.allowedVoices.length||config.allowedVoices.some(voice=>typeof voice!=="string"||!voice||voice.length>100))throw new Error("PLATFORM_TEST_ADAPTER_UNAVAILABLE");
  this.config={...config,allowedVoices:[...config.allowedVoices]};
 }
 prepare(request:Extract<PlatformModelTestRequest,{capability:"text-to-speech"}>):PreparedPlatformTestCall {
  const valid=PlatformModelTestRequest.safeParse(request);if(!valid.success||valid.data.capability!=="text-to-speech")throw new Error("PLATFORM_TEST_REQUEST_INVALID");
  const quantity=BigInt(request.bounds.maximumQuantity);
  // UTF-8 bytes conservatively bound code points, UTF-16 units and graphemes; this is a
  // reservation upper bound, not a claim that supplier billable characters equal JS length.
  if(quantity>this.config.maximumCharacters||BigInt(Buffer.byteLength(request.input.text,"utf8"))>quantity)throw new Error("PLATFORM_TEST_CHARACTER_BOUND_EXCEEDED");
  const payload={model:this.config.runtimeModelId,input:{text:request.input.text,voice:request.input.voice,...(request.input.language?{language_type:request.input.language}:{})}};
  const exact=prepareQwenTtsRequest(payload,{runtimeModelId:this.config.runtimeModelId,allowedVoices:this.config.allowedVoices,maximumUtf8Bytes:this.config.maximumUtf8Bytes,billingMode:"character"});
  const call=preparePlatformTestCall(request,this.config.runtimeModelId,payload,this.config.timeoutMs);
  if(call.serializedBody!==exact.serializedBody)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");this.prepared.add(call);return call;
 }
 async invoke(call:PreparedPlatformTestCall,hooks:PlatformTestClientHooks,callerSignal?:AbortSignal):Promise<PlatformModelTestResult>{
  if(!hooks||typeof hooks.beforeDispatch!=="function"||typeof hooks.terminal!=="function")throw new Error("PLATFORM_TEST_ACCOUNTING_UNAVAILABLE");
  if(!this.prepared.has(call)||call.capability!=="text-to-speech"||call.runtimeModelId!==this.config.runtimeModelId)throw new Error("PLATFORM_TEST_BINDING_MISMATCH");
  if(this.dispatched.has(call.physicalReceiptId))throw new Error("PLATFORM_TEST_REPLAY_NO_DISPATCH");
  const signal=callerSignal?AbortSignal.any([callerSignal,AbortSignal.timeout(call.bounds.timeoutMs)]):AbortSignal.timeout(call.bounds.timeoutMs);signal.throwIfAborted();
  this.dispatched.add(call.physicalReceiptId);const startedAt=new Date().toISOString();await hooks.beforeDispatch({...call,startedAt});
  let usage:PlatformTestReportedUsage={...unknownPlatformTestUsage(),nativeUnit:"character"},outcome:"succeeded"|"failed"="failed";
  try{
   signal.throwIfAborted();const response=await fetch(this.config.endpoint,{method:"POST",signal,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json","accept-encoding":"identity"},body:call.serializedBody});
   const body=await readPlatformTestJson(response,signal);
   // A failed generation may still have incurred physical consumption. Read only the
   // supplier's explicit character counter before business/HTTP status checks; never
   // infer it from text length, successful output, or placeholder Token fields.
   const rawUsage=body.usage;
   if(rawUsage&&typeof rawUsage==="object"&&!Array.isArray(rawUsage)){
    const counter=rawUsage as Record<string,unknown>,characters=counter.characters;
    if(typeof characters==="number"&&Number.isSafeInteger(characters)&&characters>0
     &&(counter.input_tokens===undefined||counter.input_tokens===0)&&(counter.output_tokens===undefined||counter.output_tokens===0))usage={...usage,nativeQuantity:BigInt(characters)};
   }
   if(!response.ok||body.code||(body.status_code!==undefined&&body.status_code!==200))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const output=body.output as {finish_reason?:unknown;audio?:{url?:unknown}}|undefined;
   if(output?.finish_reason!=="stop"||(usage.nativeQuantity!==null&&usage.nativeQuantity>BigInt(call.bounds.maximumQuantity!)))throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const url=output.audio?.url;if(typeof url!=="string"||url.length>2000)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   const asset=new URL(url);if(asset.protocol!=="https:"||asset.username||asset.password)throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");
   outcome="succeeded";return {kind:"audio",asset:{url,mimeType:"audio/wav"},durationMs:null};
  }catch{throw new Error("PLATFORM_TEST_PROVIDER_UNCONFIRMED");}
  finally{await hooks.terminal({physicalReceiptId:call.physicalReceiptId,startedAt,endedAt:new Date().toISOString(),outcome,usage});}
 }
}
export const PLATFORM_TEST_ASR_UNAVAILABLE_REASON="ASR_BILLING_PROTOCOL_UNVERIFIED" as const;
/** Transport-only helper, not an enabled ASR adapter or billable-duration measurement.
 * Qwen ASR supports WAV, while platform input is raw mono PCM16. Explicit 16/24 kHz,
 * canonical bytes and a finite duration bound are required before any future adapter.
 * Source: https://help.aliyun.com/en/model-studio/qwen-asr-api-reference (observed 2026-10-05).
 */
export function encodePlatformTestPcm16Wav(input:{audioBase64:string;sampleRateHz:16000|24000;channels:1;format:"pcm16"},maximumAudioMilliseconds:number):{wav:Buffer;boundedDurationMs:number}{
 if(!Number.isSafeInteger(maximumAudioMilliseconds)||maximumAudioMilliseconds<1||maximumAudioMilliseconds>60_000
  ||(input.sampleRateHz!==16000&&input.sampleRateHz!==24000)||input.channels!==1||input.format!=="pcm16"
  ||typeof input.audioBase64!=="string"||input.audioBase64.length<4||input.audioBase64.length>3_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64))throw new Error("PLATFORM_TEST_AUDIO_INPUT_INVALID");
 const pcm=Buffer.from(input.audioBase64,"base64");if(!pcm.length||pcm.length%2!==0||pcm.toString("base64")!==input.audioBase64
  ||BigInt(pcm.length)*1000n>BigInt(input.sampleRateHz)*2n*BigInt(maximumAudioMilliseconds))throw new Error("PLATFORM_TEST_AUDIO_BOUND_EXCEEDED");
 const wav=Buffer.alloc(44+pcm.length);wav.write("RIFF",0);wav.writeUInt32LE(36+pcm.length,4);wav.write("WAVE",8);wav.write("fmt ",12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(input.sampleRateHz,24);wav.writeUInt32LE(input.sampleRateHz*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
 return {wav,boundedDurationMs:Math.ceil(pcm.length*1000/(input.sampleRateHz*2))};
}
