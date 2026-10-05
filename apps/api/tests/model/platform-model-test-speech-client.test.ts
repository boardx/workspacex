import {randomUUID} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {PlatformTestSpeechClient,encodePlatformTestPcm16Wav,PLATFORM_TEST_ASR_UNAVAILABLE_REASON,type PlatformTestSpeechConfig} from "../../src/infrastructure/model/platform-test-speech-client";
import type {PlatformTestClientHooks} from "../../src/infrastructure/model/platform-test-vector-client";
import type {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
const config:PlatformTestSpeechConfig={endpoint:"https://trusted.invalid/api/v1/services/aigc/multimodal-generation/generation",apiKey:"fixture-secret",runtimeModelId:"qwen3-tts-flash",protocol:"qwen-tts-character",allowedVoices:["Cherry"],maximumCharacters:600n,maximumUtf8Bytes:4000,timeoutMs:1000};
const request=():Extract<PlatformModelTestRequest,{capability:"text-to-speech"}>=>({testId:randomUUID(),orgId:"org",modelId:"registered-org-model",declaredNonConfidential:true,capability:"text-to-speech",input:{text:"hello",voice:"Cherry",language:"English"},bounds:{maximumCostMicros:"100",maximumQuantity:"30",timeoutMs:1000}});
const hooks=()=>({beforeDispatch:vi.fn(async(_call:Parameters<PlatformTestClientHooks["beforeDispatch"]>[0])=>{}),terminal:vi.fn(async(_event:Parameters<PlatformTestClientHooks["terminal"]>[0])=>{})});
const result=(usage:unknown={input_tokens:0,output_tokens:0,characters:5},url="https://audio.invalid/voice.wav")=>({status_code:200,output:{finish_reason:"stop",audio:{url}},usage});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("prepares exact immutable bytes, gates one paid call and meters only reported characters",async()=>{
 const client=new PlatformTestSpeechClient(config),input=request(),prepared=client.prepare(input),callbacks=hooks(),order:string[]=[];
 callbacks.beforeDispatch.mockImplementation(async call=>{order.push("gate");expect(call.serializedBody).toBe(prepared.serializedBody);});
 const fetcher=vi.fn(async(url:unknown,options?:RequestInit)=>{order.push("paid");expect(url).toBe(config.endpoint);expect(options?.body).toBe(prepared.serializedBody);expect(options?.redirect).toBe("error");expect(options?.headers).toMatchObject({authorization:"Bearer fixture-secret"});return Response.json(result());});vi.stubGlobal("fetch",fetcher);
 input.input.text="mutated";expect(Object.isFrozen(prepared)).toBe(true);expect(Object.isFrozen(prepared.bounds)).toBe(true);
 expect(await client.invoke(prepared,callbacks)).toEqual({kind:"audio",asset:{url:"https://audio.invalid/voice.wav",mimeType:"audio/wav"},durationMs:null});expect(order).toEqual(["gate","paid"]);
 expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"succeeded",usage:{nativeUnit:"character",nativeQuantity:5n,tokensTotal:null,inputTokens:null,outputTokens:null}});
 await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PLATFORM_TEST_REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([undefined,{input_tokens:0,output_tokens:0},{input_tokens:0,output_tokens:0,characters:0},{input_tokens:0,output_tokens:0,characters:1.1},{input_tokens:3,output_tokens:4,characters:5}])("unverified usage %j is held as unknown, never fabricated Token zero",async usage=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...result(),usage})));
 await client.invoke(client.prepare(request()),callbacks);expect(callbacks.terminal.mock.calls[0]?.[0].usage).toMatchObject({nativeUnit:"character",nativeQuantity:null,tokensTotal:null,inputTokens:null,outputTokens:null});
});
it("supports the raw HTTP status without inventing SDK status_code or usage",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks();const {status_code:_status,...body}=result();vi.stubGlobal("fetch",vi.fn(async()=>Response.json(body)));
 await client.invoke(client.prepare(request()),callbacks);expect(callbacks.terminal.mock.calls[0]?.[0].usage.nativeQuantity).toBe(5n);
});
it("missing accounting or rejected admission emits zero supplier requests",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks(),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);callbacks.beforeDispatch.mockRejectedValue(new Error("admission denied"));await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("admission denied");expect(fetcher).not.toHaveBeenCalled();expect(callbacks.terminal).not.toHaveBeenCalled();
});
it("refuses changed prepared bodies and requires deployment-confirmed voice/model/bounds",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks(),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const prepared=client.prepare(request());await expect(client.invoke({...prepared,serializedBody:'{"model":"other"}'},callbacks)).rejects.toThrow("BINDING_MISMATCH");expect(fetcher).not.toHaveBeenCalled();
 expect(()=>client.prepare({...request(),input:{text:"hello",voice:"unconfirmed"}})).toThrow("DEPLOYMENT_BINDING_MISMATCH");expect(()=>client.prepare({...request(),input:{text:"中文",voice:"Cherry"},bounds:{...request().bounds,maximumQuantity:"2"}})).toThrow("CHARACTER_BOUND_EXCEEDED");expect(()=>client.prepare({...request(),bounds:{...request().bounds,maximumQuantity:"601"}})).toThrow("CHARACTER_BOUND_EXCEEDED");expect(()=>new PlatformTestSpeechClient({...config,maximumCharacters:601n})).toThrow("ADAPTER_UNAVAILABLE");
});
it("Unicode reservation bound is conservative UTF8 bytes rather than supplier usage guess",()=>{
 const client=new PlatformTestSpeechClient(config),input={...request(),input:{text:"中😀",voice:"Cherry"},bounds:{...request().bounds,maximumQuantity:"7"}};
 expect(JSON.parse(client.prepare(input).serializedBody).input.text).toBe("中😀");expect(()=>client.prepare({...input,bounds:{...input.bounds,maximumQuantity:"6"}})).toThrow("CHARACTER_BOUND_EXCEEDED");
});
it("oversized reported quantity remains metered and rejects successful result",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json(result({input_tokens:0,output_tokens:0,characters:31}))));await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{nativeQuantity:31n}});
});
it.each(["http://audio.invalid/voice.wav","https://user:pass@audio.invalid/voice.wav","data:audio/wav;base64,AAAA"])("rejects unsafe output %s while retaining known consumption",async url=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>Response.json(result({input_tokens:0,output_tokens:0,characters:5},url))));await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0].usage.nativeQuantity).toBe(5n);
});
it("cancel and lost response never resubmit and keep unknown native usage",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks(),abort=new AbortController(),fetcher=vi.fn(async()=>{abort.abort();throw new Error("lost fixture-secret");});vi.stubGlobal("fetch",fetcher);await expect(client.invoke(client.prepare(request()),callbacks,abort.signal)).rejects.toThrow("PROVIDER_UNCONFIRMED");expect(fetcher).toHaveBeenCalledTimes(1);expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{nativeQuantity:null,tokensTotal:null}});
});
it("response size is bounded without accepting truncated usage",async()=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks();vi.stubGlobal("fetch",vi.fn(async()=>new Response('x'.repeat(2_000_001))));await expect(client.invoke(client.prepare(request()),callbacks)).rejects.toThrow("PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0].usage.nativeQuantity).toBe(null);
});
it.each([16000,24000] as const)("encodes mono PCM16 at %i Hz into correct bounded WAV bytes, no billable duration claim",sampleRateHz=>{
 const pcm=Buffer.alloc(sampleRateHz*2);pcm.writeInt16LE(-1234,0);const {wav,boundedDurationMs}=encodePlatformTestPcm16Wav({audioBase64:pcm.toString("base64"),sampleRateHz,channels:1,format:"pcm16"},1000);
 expect(wav.subarray(0,4).toString()).toBe("RIFF");expect(wav.readUInt32LE(4)).toBe(36+pcm.length);expect(wav.subarray(8,12).toString()).toBe("WAVE");expect(wav.readUInt16LE(20)).toBe(1);expect(wav.readUInt16LE(22)).toBe(1);expect(wav.readUInt32LE(24)).toBe(sampleRateHz);expect(wav.readUInt32LE(28)).toBe(sampleRateHz*2);expect(wav.readUInt16LE(34)).toBe(16);expect(wav.readUInt32LE(40)).toBe(pcm.length);expect(wav.subarray(44)).toEqual(pcm);expect(boundedDurationMs).toBe(1000);expect(PLATFORM_TEST_ASR_UNAVAILABLE_REASON).toBe("ASR_BILLING_PROTOCOL_UNVERIFIED");
 expect(()=>encodePlatformTestPcm16Wav({audioBase64:pcm.toString("base64"),sampleRateHz,channels:1,format:"pcm16"},999)).toThrow("AUDIO_BOUND_EXCEEDED");
});
it.each(["","AA==","AAAAA=","AAA=\n","data:audio/wav;base64,AAAA"])("rejects malformed or non-PCM-aligned audio %j",audioBase64=>expect(()=>encodePlatformTestPcm16Wav({audioBase64,sampleRateHz:16000,channels:1,format:"pcm16"},1000)).toThrow());

it.each([{status:503,code:"ServiceUnavailable"},{status:200,code:"PartialGenerationFailure"},{status:400,code:"InvalidInputAfterPartialProcessing"}])("failed supplier response %j retains actual characters, without retry",async failure=>{
 const client=new PlatformTestSpeechClient(config),callbacks=hooks(),fetcher=vi.fn(async()=>Response.json({status_code:failure.status,code:failure.code,usage:{characters:5,input_tokens:0,output_tokens:0}},{status:failure.status}));vi.stubGlobal("fetch",fetcher);
 const prepared=client.prepare(request());await expect(client.invoke(prepared,callbacks)).rejects.toThrow("PROVIDER_UNCONFIRMED");expect(callbacks.terminal.mock.calls[0]?.[0]).toMatchObject({outcome:"failed",usage:{nativeUnit:"character",nativeQuantity:5n,tokensTotal:null}});await expect(client.invoke(prepared,callbacks)).rejects.toThrow("REPLAY_NO_DISPATCH");expect(fetcher).toHaveBeenCalledTimes(1);
});
