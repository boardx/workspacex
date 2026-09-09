import {createServer,type Server,type RequestListener} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,expect,it} from 'vitest';
import {BailianImageProvider} from '../../src/infrastructure/agent-run/bailian-image-provider';
let server:Server|undefined;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}});
async function provider(handler:RequestListener,timeoutMs=1000){
 server=createServer(handler);await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 return new BailianImageProvider({apiKey:'test-only-secret',modelId:'fixed-image-model',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,timeoutMs,pollIntervalMs:1});
}
it('returns a structured existing-provider result without duplicate submission',async()=>{
 let submits=0,polls=0;
 const p=await provider((req,res)=>{res.setHeader('content-type','application/json');if(req.method==='POST'){submits++;res.end(JSON.stringify({output:{task_id:'one-task'}}));}else{polls++;res.end(JSON.stringify({output:polls===1?{task_status:'RUNNING'}:{task_status:'SUCCEEDED',results:[{url:'https://example.com/result.png'}]}}));}});
 expect(await p.generateImage('a tree')).toEqual({url:'https://example.com/result.png',taskId:'one-task',modelRef:'fixed-image-model'});expect(submits).toBe(1);expect(polls).toBe(2);
});
/**
 * #3175/#3176 之后仍在 gates-test shard 3/4 上以 60000ms 假红重现（见 #3163/#3168/#3162
 * 的 PR 合并 SOP 记录）：这条原来用**真的本地 http server** 制造"响应头到了、body 永远
 * 不 end"，能不能在 2000ms 内 reject 取决于本机 undici 肯不肯在 deadline 到点时把连接
 * 销毁掉——同 45 行那条 `enforces its own deadline` 的注释所诊断的一模一样，只是当时
 * 只把注释加在了下面那条新增的确定性用例上，没把这条本身也换掉。
 *
 * 换成和 45 行同样的手法：stub `fetch` 直接返回"headers 已到、body 永不 enqueue/close"
 * 的 `ReadableStream`，不再依赖真实 socket 与 undici 的 abort 行为。"不重复提交"这条断言
 * 换成对 stub fetch 调用次数计数——同样不依赖真实 server。
 */
it('deadline aborts a stalled submission body and does not resubmit',async()=>{
 const realFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Response(new ReadableStream({start(){/* never yields */}}),{status:200,headers:{'content-type':'application/json'}});}) as typeof fetch;
 try{
  const p=new BailianImageProvider({apiKey:'test-only-secret',modelId:'fixed-image-model',baseUrl:'http://127.0.0.1:9',timeoutMs:100,pollIntervalMs:1});
  const started=Date.now();
  await expect(p.generateImage('a tree')).rejects.toThrow('MODEL_CALL_FAILED');
  expect(Date.now()-started).toBeLessThan(2000);expect(calls).toBe(1);
 } finally {globalThis.fetch=realFetch;}
},10_000);
it('caller cancellation aborts polling and stops future requests',async()=>{
 const abort=new AbortController();let polls=0;
 const p=await provider((req,res)=>{if(req.method==='POST')res.end(JSON.stringify({output:{task_id:'one-task'}}));else{polls++;res.writeHead(200);res.write('{');abort.abort();}});
 await expect(p.generateImage('a tree',abort.signal)).rejects.toThrow('MODEL_CALL_FAILED');expect(polls).toBe(1);
});
it.each(['oversize','redirect','task-path','task-type','result-url'])('rejects %s responses without exposing provider content',async mode=>{
 let requests=0;
 const p=await provider((req,res)=>{requests++;
  if(mode==='oversize'){res.end('sensitive-provider-content'.repeat(5000));return;}
  if(mode==='redirect'){res.writeHead(302,{location:'/do-not-follow'});res.end();return;}
  if(req.method==='POST'){res.end(JSON.stringify({output:{task_id:mode==='task-path'?'../../sensitive':mode==='task-type'?123:'one-task'}}));return;}
  res.end(JSON.stringify({output:{task_status:'SUCCEEDED',results:[{url:'javascript:alert(1)'}]}}));
 });
 await expect(p.generateImage('a tree')).rejects.toThrow('MODEL_CALL_FAILED');expect(requests).toBe(mode==='result-url'?2:1);
});
/**
 * #3175 的回归门。上面那条 'deadline aborts a stalled submission body' 用的是**真的
 * 本地 http server**——它能不能红，取决于本机 undici 肯不肯在 signal 触发时销毁 body。
 * macOS 上 550 次一次没红，Linux CI 上卡满 60002ms 被判超时；也就是说，那条断言在
 * 一半的机器上根本测不到"deadline 是我们自己保证的"这件事，它只是在替 transport 打分。
 *
 * 这条把 transport 换成一个**明确不理会 signal** 的替身（body 是永不 enqueue、永不
 * close、永不 error 的 `ReadableStream`）。于是"能不能在 deadline 内 reject"只剩下
 * 一个可能的来源：`readBoundedJson` 自己的读循环。它在每台机器上都是确定性的。
 */
it('enforces its own deadline when the transport ignores the abort signal',async()=>{
 const realFetch=globalThis.fetch;
 globalThis.fetch=(async()=>new Response(new ReadableStream({start(){/* never yields */}}),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch;
 try{
  const p=new BailianImageProvider({apiKey:'test-only-secret',modelId:'fixed-image-model',baseUrl:'http://127.0.0.1:9',timeoutMs:100,pollIntervalMs:1});
  const started=Date.now();
  await expect(p.generateImage('a tree')).rejects.toThrow('MODEL_CALL_FAILED');
  expect(Date.now()-started).toBeLessThan(2000);
 } finally {globalThis.fetch=realFetch;}
},10_000);
