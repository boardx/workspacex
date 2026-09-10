/**
 * `OpenAiImageProvider` 的真实 HTTP 形状取证（人类直接指令 2026-09-10：「我需要你可以
 * 接入 openai」）。用本地 stub server 顶替 `api.openai.com`——`baseUrl` 可配置正是为此，
 * 与 `bailian-image-bounds.test.ts` 同一手法。
 *
 * 这里测的是**这条 provider 自己的判定**：base64 → inline、url → url、两者都没有 →
 * 显式失败、非 2xx → 不泄漏上游正文、`response_format` 按模型分流。真实 OpenAI 账号下
 * 的端到端出图不在本文件范围（没有 key 的环境跑不了，写成会跳过的用例等于没有门）。
 */
import {createServer,type Server,type RequestListener} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,expect,it} from 'vitest';
import {OpenAiImageProvider,readOpenAiImageProviderConfig} from '../../src/infrastructure/agent-run/openai-image-provider';

let server:Server|undefined;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}});

/** 1x1 PNG，真的 PNG magic number——`DefaultStandardImageService` 的 inline 分支要嗅探它。 */
const PNG_1X1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

async function provider(handler:RequestListener,modelId='gpt-image-1',timeoutMs=2000){
 server=createServer(handler);await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 return new OpenAiImageProvider({apiKey:'test-only-secret',modelId,baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,timeoutMs,organization:null,project:null});
}
const json=(res:Parameters<RequestListener>[1],body:unknown,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));};

it('delivers gpt-image base64 inline: the bytes come back in the response, with no second hop to download',async()=>{
 let hits=0,path='',auth='';
 const p=await provider((req,res)=>{hits++;path=req.url??'';auth=req.headers.authorization??'';json(res,{created:1730000000,data:[{b64_json:PNG_1X1.toString('base64')}]});});
 const result=await p.generateImage('a six panel canvas');
 expect(hits).toBe(1);expect(path).toBe('/v1/images/generations');expect(auth).toBe('Bearer test-only-secret');
 expect(result.delivery).toBe('inline');
 if(result.delivery!=='inline')throw new Error('unreachable');
 expect(Buffer.from(result.bytes).equals(PNG_1X1)).toBe(true);
 expect(result.modelRef).toBe('gpt-image-1');
 // 同步接口没有作业号，合成的 id 如实带上模型与 created，不冒充 OpenAI 的作业标识。
 expect(result.taskId).toBe('openai:gpt-image-1:1730000000');
});

it('delivers a url when the model returns one instead of bytes',async()=>{
 const p=await provider((_req,res)=>json(res,{created:1,data:[{url:'https://cdn.example.com/i.png'}]}),'dall-e-3');
 const result=await p.generateImage('a tree');
 expect(result).toEqual({delivery:'url',url:'https://cdn.example.com/i.png',taskId:'openai:dall-e-3:1',modelRef:'dall-e-3'});
});

it('sends response_format only for dall-e models: gpt-image rejects that parameter upstream',async()=>{
 const bodies:string[]=[];
 const handler:RequestListener=(req,res)=>{let raw='';req.on('data',c=>{raw+=c;});req.on('end',()=>{bodies.push(raw);json(res,{created:1,data:[{b64_json:PNG_1X1.toString('base64')}]});});};
 const gpt=await provider(handler,'gpt-image-1');await gpt.generateImage('x');
 server!.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;
 const dalle=await provider(handler,'dall-e-3');await dalle.generateImage('x');
 expect(JSON.parse(bodies[0]!)).toEqual({model:'gpt-image-1',prompt:'x',n:1,size:'1024x1024'});
 expect(JSON.parse(bodies[1]!)).toMatchObject({model:'dall-e-3',response_format:'b64_json'});
});

it('fails explicitly when the response carries neither bytes nor a url',async()=>{
 const p=await provider((_req,res)=>json(res,{created:1,data:[{}]}));
 await expect(p.generateImage('x')).rejects.toThrow('MODEL_CALL_FAILED');
});

it('rejects undecodable base64 rather than writing a zero-byte image',async()=>{
 const p=await provider((_req,res)=>json(res,{created:1,data:[{b64_json:'!!!!'}]}));
 await expect(p.generateImage('x')).rejects.toThrow('MODEL_CALL_FAILED');
});

it('rejects a non-https url the same way the bailian path does',async()=>{
 const p=await provider((_req,res)=>json(res,{created:1,data:[{url:'http://cdn.example.com/i.png'}]}),'dall-e-3');
 await expect(p.generateImage('x')).rejects.toThrow('MODEL_CALL_FAILED');
});

it('does not leak the upstream error body on a non-2xx response',async()=>{
 const p=await provider((_req,res)=>json(res,{error:{message:'sk-live-SECRET-IN-UPSTREAM-TEXT quota exceeded'}},429));
 await expect(p.generateImage('x')).rejects.toThrow(/^MODEL_CALL_FAILED/);
 await expect(p.generateImage('x')).rejects.not.toThrow(/SECRET-IN-UPSTREAM-TEXT/);
});

it('refuses to call upstream at all when no key is configured',async()=>{
 let hits=0;
 server=createServer((_req,res)=>{hits++;json(res,{created:1,data:[{b64_json:PNG_1X1.toString('base64')}]});});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 const p=new OpenAiImageProvider({apiKey:'',modelId:'gpt-image-1',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,timeoutMs:2000,organization:null,project:null});
 await expect(p.generateImage('x')).rejects.toThrow('MODEL_PROVIDER_NOT_CONFIGURED');
 expect(hits).toBe(0);
});

it('reads the key from either KERNEL_OPENAI_API_KEY or OPENAI_API_KEY, and defaults the rest',()=>{
 expect(readOpenAiImageProviderConfig({OPENAI_API_KEY:'  plain  '} as NodeJS.ProcessEnv))
  .toEqual({apiKey:'plain',modelId:'gpt-image-1',baseUrl:'https://api.openai.com',timeoutMs:120000,organization:null,project:null});
 expect(readOpenAiImageProviderConfig({KERNEL_OPENAI_API_KEY:'k',OPENAI_API_KEY:'ignored',KERNEL_OPENAI_IMAGE_MODEL_ID:'gpt-image-2',KERNEL_OPENAI_IMAGE_BASE_URL:'https://proxy.example.com/'} as NodeJS.ProcessEnv))
  .toMatchObject({apiKey:'k',modelId:'gpt-image-2',baseUrl:'https://proxy.example.com'});
});
