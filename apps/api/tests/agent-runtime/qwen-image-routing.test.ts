import {expect,it,vi,afterEach} from 'vitest';
import {BailianImageProvider,readBailianImageProviderConfig,deriveBailianImageBaseUrl} from '../../src/infrastructure/agent-run/bailian-image-provider';
import {resolveImageProfile} from '@repo/contracts/standard-image-tools';
afterEach(()=>vi.unstubAllGlobals());
it('defaults to Qwen3 and resolves the three fixed tariff profiles',()=>{
 expect(readBailianImageProviderConfig({}).modelId).toBe('qwen-image-3.0');
 expect(resolveImageProfile({sizeProfile:'square'})).toMatchObject({modelId:'qwen-image-3.0',dimension:1024});
 expect(resolveImageProfile({sizeProfile:'square-hd'})).toMatchObject({modelId:'qwen-image-3.0-pro',dimension:2048});
 expect(resolveImageProfile({sizeProfile:'square',generationProfile:'icon'})).toMatchObject({modelId:'z-image-turbo',dimension:1024});
});
it.each(['standard','complex','icon'] as const)('dispatches %s using exact admitted body and real protocol shape',async profile=>{
 const modelId=profile==='icon'?'z-image-turbo':profile==='complex'?'qwen-image-3.0-pro':'qwen-image-3.0';
 const dimension=profile==='complex'?2048:1024;let admitted='',terminal:any;const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(profile==='icon'?{request_id:'sync-id',output:{choices:[{message:{content:[{image:'https://example.com/image.png'}]}}]},usage:{image_count:1}}:options?.method==='POST'?{output:{task_id:'task'}}:{output:{task_status:'SUCCEEDED',choices:[{message:{content:[{image:'https://example.com/image.png'}]}}]},usage:{output_image_count:1}}));}));
 const p=new BailianImageProvider({apiKey:'test',modelId:'qwen-image-3.0',baseUrl:'https://example.com',timeoutMs:1000,pollIntervalMs:1},{start:async(_context,request)=>{expect(request.modelId).toBe(modelId);admitted=request.serializedBody;return {terminal:async input=>{terminal=input;}};}});
 const result=await p.generateImage('a tree',undefined,{orgId:'org' as any,parentRunId:'run',attemptId:'attempt',leaseEpoch:1},{sizeProfile:'square',generationProfile:profile});
 expect(result.modelRef).toBe(modelId);expect(calls[0].options.body).toBe(admitted);
 expect(JSON.parse(admitted)).toMatchObject({model:modelId,input:{messages:[{role:'user',content:[{text:'a tree'}]}]},parameters:{size:`${dimension}*${dimension}`}});
 expect(calls[0].url).toContain(profile==='icon'?'/multimodal-generation/generation':'/image-generation/generation');
 expect(calls).toHaveLength(profile==='icon'?1:2);expect(terminal).toMatchObject({quantity:1n,outcome:'succeeded'});
});
it('does not dispatch without configured accounting policy',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const p=new BailianImageProvider({apiKey:'test',modelId:'qwen-image-3.0',baseUrl:'https://example.com',timeoutMs:1000,pollIntervalMs:1},{start:async()=>{throw new Error('AI_IMAGE_POLICY_UNCONFIGURED');}});
 await expect(p.generateImage('a tree',undefined,{orgId:'org' as any,parentRunId:'run',attemptId:'a',leaseEpoch:1})).rejects.toThrow('AI_IMAGE_POLICY_UNCONFIGURED');expect(fetch).not.toHaveBeenCalled();
});

it('derives only official same-region DashScope hosts, with explicit override taking precedence',()=>{
 expect(deriveBailianImageBaseUrl('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')).toBe('https://dashscope-intl.aliyuncs.com');
 expect(deriveBailianImageBaseUrl('https://abc.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1')).toBe('https://abc.ap-southeast-1.maas.aliyuncs.com');
 for(const url of ['https://dashscope-intl.aliyuncs.com.evil.test/v1','http://dashscope-intl.aliyuncs.com/v1','https://secret@dashscope-intl.aliyuncs.com/v1'])expect(deriveBailianImageBaseUrl(url)).toBe('https://dashscope.aliyuncs.com');
 expect(readBailianImageProviderConfig({KERNEL_MODEL_BASE_URL:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',KERNEL_BAILIAN_IMAGE_BASE_URL:'https://configured.test'}).baseUrl).toBe('https://configured.test');
});
it.each(['qwen-image-3.0','z-image-turbo'])('keeps %s failures failed with one terminal receipt and unknown usage',async modelId=>{
 let terminals:any[]=[];const fetch=vi.fn(async()=>new Response(JSON.stringify(modelId==='z-image-turbo'?{request_id:'sync',output:{choices:[]}}:{output:{task_id:'task',task_status:'FAILED'}})));vi.stubGlobal('fetch',fetch);
 const p=new BailianImageProvider({apiKey:'test',modelId,baseUrl:'https://example.com',timeoutMs:1000,pollIntervalMs:1},{start:async()=>({terminal:async input=>{terminals.push(input);}})});
 await expect(p.generateImage('tree',undefined,{orgId:'o' as any,parentRunId:'r',attemptId:'a',leaseEpoch:1})).rejects.toThrow('MODEL_CALL_FAILED');expect(terminals).toHaveLength(1);expect(terminals[0]).toMatchObject({outcome:'failed',quantity:null});expect(fetch).toHaveBeenCalledTimes(modelId==='z-image-turbo'?1:2);
});
