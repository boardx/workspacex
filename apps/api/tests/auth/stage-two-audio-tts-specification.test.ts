import {it,expect} from 'vitest';
import {prepareQwenTtsRequest,priceQwenCharacterTtsBound,readQwenTtsReportedUsage,type VerifiedQwenCharacterBound} from '../../src/infrastructure/recording/qwen-tts-specification';
const spec={runtimeModelId:'configured-tts',allowedVoices:['verified-voice'],maximumUtf8Bytes:2000,billingMode:'character' as const};
const payload={model:spec.runtimeModelId,input:{text:'你好 🌍',voice:'verified-voice',language_type:'Chinese'}};
it('prepares exact declared dialect without inventing defaults or converting UTF-8 text to billable units',()=>{
 const prepared=prepareQwenTtsRequest(payload,spec);expect(JSON.parse(prepared.serializedBody)).toEqual(payload);expect(prepared.serializedBodySha256).toMatch(/^[a-f0-9]{64}$/);
 const minimal=prepareQwenTtsRequest({...payload,input:{text:'hello',voice:'verified-voice'}},spec);expect(JSON.parse(minimal.serializedBody).input).not.toHaveProperty('language_type');
});
it.each([
 {...payload,model:'foreign-model'}, {...payload,input:{...payload.input,voice:'unverified-voice'}},
 {...payload,input:{...payload.input,text:''}}, {...payload,input:{...payload.input,instructions:'unbounded-token-instruction'}},
 {...payload,parameters:{temperature:1}}, {...payload,input:{...payload.input,language_type:'invented'}},
 {...payload,input:{text:1,voice:'verified-voice'}},
])('rejects unsupported or mismatched supplier parameters',value=>{expect(()=>prepareQwenTtsRequest(value,spec)).toThrow();});
it('transport limits remain separate from provider billing measurements and bounded verified native price',()=>{
 expect(()=>prepareQwenTtsRequest(payload,{...spec,maximumUtf8Bytes:5})).toThrow('TTS_TRANSPORT_INPUT_BOUND_EXCEEDED');
 const prepared=prepareQwenTtsRequest(payload,spec),bound:VerifiedQwenCharacterBound={runtimeModelId:spec.runtimeModelId,serializedBodySha256:prepared.serializedBodySha256,maximumCharacters:7n,maximumDeploymentCharacters:600n,bindingVerified:true,price:{unit:'character',quantum:1000n,microsPerQuantum:3n,currency:'CNY',version:'audited-native-v1'}};
 expect(priceQwenCharacterTtsBound(prepared,bound)).toBe(1n);
 for(const delta of [{serializedBodySha256:'unrelated'},{runtimeModelId:'other'},{maximumCharacters:601n},{maximumCharacters:0n},{bindingVerified:false as never},{price:{...bound.price,version:''}}])expect(()=>priceQwenCharacterTtsBound(prepared,{...bound,...delta})).toThrow();
 expect(()=>priceQwenCharacterTtsBound({...prepared,billingMode:'audio-token'},bound)).toThrow('TTS_CHARACTER_BOUND_UNVERIFIED');
});
const finished=(usage:unknown)=>({status_code:200,output:{finish_reason:'stop'},usage});
it('native character usage preserves real characters and does not turn placeholder Tokens into a token event',()=>{
 expect(readQwenTtsReportedUsage(finished({characters:195,input_tokens:0,output_tokens:0}),'character')).toEqual({kind:'native',unit:'character',quantity:195n,source:'reported'});
});
it.each([undefined,{}, {characters:-1},{characters:1.1},{characters:'195'},{characters:true},{characters:Number.MAX_SAFE_INTEGER+1},{characters:195,input_tokens:3}])('missing or malformed native usage retains unknown cost',usage=>{
 expect(readQwenTtsReportedUsage(finished(usage),'character')).toMatchObject({quantity:null,source:'unknown'});
});
it('real audio-token family remains token billing, including output audio tokens without double counting',()=>{
 const usage={input_tokens:76,output_tokens:1045,total_tokens:1121,characters:0,input_tokens_details:{text_tokens:76},output_tokens_details:{audio_tokens:1045,text_tokens:0}};
 expect(readQwenTtsReportedUsage(finished(usage),'audio-token')).toEqual({kind:'token',input:76n,output:1045n,total:1121n,audioOutput:1045n,source:'reported'});
 for(const delta of [{total_tokens:1122},{output_tokens_details:{audio_tokens:1000,text_tokens:0}},{characters:195}])expect(readQwenTtsReportedUsage(finished({...usage,...delta}),'audio-token')).toMatchObject({source:'unknown',total:null});
});
it('partial SSE, supplier error and cancellation without final bill stay unknown',()=>{
 for(const response of [{status_code:200,output:{finish_reason:null},usage:{characters:50}}, {status_code:500,output:{finish_reason:'stop'},usage:{characters:0}},null])expect(readQwenTtsReportedUsage(response,'character')).toMatchObject({quantity:null,source:'unknown'});
});
it('invalid deployment limits, absent voices and unknown billing dialect never prepare a request',()=>{
 for(const delta of [{maximumUtf8Bytes:0},{maximumUtf8Bytes:1.5},{maximumUtf8Bytes:2_000_001},{allowedVoices:[]},{runtimeModelId:''},{billingMode:'unknown' as never}])expect(()=>prepareQwenTtsRequest(payload,{...spec,...delta})).toThrow('TTS_DEPLOYMENT_SPECIFICATION_UNVERIFIED');
});
