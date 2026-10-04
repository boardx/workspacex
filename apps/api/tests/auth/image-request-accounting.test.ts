import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,it,expect,vi} from 'vitest';
import {OpenAiImageProvider,readImageUsage} from '../../src/infrastructure/agent-run/openai-image-provider';
import {PgImageRequestAccounting} from '../../src/infrastructure/auth/pg-image-request-accounting';
import {toOrgId} from '../../src/domain/org-id';
import type {ImageRequestAccounting} from '../../src/application/agent-run/image-request-accounting';
const context={orgId:toOrgId('image-org'),parentRunId:'run-A',attemptId:'run-A:0',leaseEpoch:1,bindingId:'binding',toolCallId:'tool'};
let server:Server|undefined;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}});
async function fixture(status:number,usage:unknown,accounting:ImageRequestAccounting,quota=false){
 const paid=vi.fn();server=createServer((_req,res)=>{paid();res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{b64_json:'AQ=='}],usage}));});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 return {paid,provider:new OpenAiImageProvider({apiKey:'fixture-key',modelId:'fixed-image',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,timeoutMs:1000,organization:null,project:null},accounting,quota)};
}
it('persists start before actual HTTP and reports success/failed billed usage once without prompt/base64',async()=>{
 const terminal=vi.fn(),start=vi.fn(async()=>({terminal}));
 const f=await fixture(503,{total_tokens:7,input_tokens:4,output_tokens:3},{start});
 f.paid.mockImplementation(()=>expect(start).toHaveBeenCalledOnce());
 await expect(f.provider.generateImage('private prompt',undefined,context)).rejects.toThrow();
 expect(f.paid).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();
 expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',usage:{total:7,prompt:4,completion:3}});
 expect(JSON.stringify(start.mock.calls)).not.toContain('private prompt');expect(JSON.stringify(terminal.mock.calls)).not.toContain('AQ==');
});
it('missing usage is unknown, start denial/missing owner/native admission sends zero HTTP',async()=>{
 const terminal=vi.fn(),start=vi.fn(async()=>({terminal}));const f=await fixture(200,undefined,{start});
 await f.provider.generateImage('prompt',undefined,context);expect(terminal.mock.calls[0]?.[0]).toMatchObject({usage:{},outcome:'succeeded'});
 await expect(f.provider.generateImage('prompt')).rejects.toThrow();expect(f.paid).toHaveBeenCalledTimes(1);
 start.mockRejectedValueOnce(new Error('owner denied'));await expect(f.provider.generateImage('prompt',undefined,context)).rejects.toThrow();expect(f.paid).toHaveBeenCalledTimes(1);
});
it('unimplemented native admission rejects before even durable start',async()=>{
 const start=vi.fn(async()=>({terminal:vi.fn()})),f=await fixture(200,{}, {start},true);
 await expect(f.provider.generateImage('prompt',undefined,context)).rejects.toThrow();expect(start).not.toHaveBeenCalled();expect(f.paid).not.toHaveBeenCalled();
});
it('cancel after durable start produces a failed terminal but no vendor dispatch',async()=>{
 const signal=new AbortController(),terminal=vi.fn(),start=vi.fn(async()=>{signal.abort();return {terminal};}),f=await fixture(200,{}, {start});
 await expect(f.provider.generateImage('prompt',signal.signal,context)).rejects.toThrow();expect(f.paid).not.toHaveBeenCalled();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',usage:{}});
});
it('sanitizes missing/noninteger vendor dimensions without inventing token counts',()=>{
 expect(readImageUsage({total_tokens:-1,input_tokens:3.5,output_tokens:Infinity})).toEqual({});
 expect(readImageUsage({input_tokens:4})).toEqual({prompt:4});
});
it('trusted ownership is rederived before start and terminal uses captured original actor after cancellation',async()=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('JOIN chat_messages')?[{user_id:'original',root_run_id:'root',subtask_id:null,project_id:'project',thread_id:'thread',agent_id:'agent'}]:[]}));
 const db={withTenant:vi.fn(async(org:unknown,work:(s:unknown)=>unknown)=>{expect(org).toBe(context.orgId);return work({query});})};
 const receipt=await new PgImageRequestAccounting(db as never).start(context,{requestId:'unique-http',modelId:'fixed-image',startedAt:new Date().toISOString()});
 query.mockImplementation(async()=>({rows:[]}));await receipt.terminal({endedAt:new Date().toISOString(),outcome:'failed',usage:{}});
 const start=query.mock.calls.find(c=>c[0].includes('INTO model_request_starts')) as unknown as [string,unknown[]];
 const write=query.mock.calls.find(c=>c[0].includes('INTO token_usage_events')) as unknown as [string,unknown[]];
 expect(start[1][2]).toBe('original');expect(start[1].slice(12)).toEqual([1,null,null]);expect(write[1][2]).toBe('original');expect(write[1][0]).toBe('unique-http');expect(write[1].slice(24)).toEqual(['image',null,'unknown']);
});

it('terminal write failure preserves the already-paid image, blocks later HTTP, never retries model',async()=>{
 const terminal=vi.fn(async()=>{throw new Error('ledger unavailable');}),start=vi.fn(async()=>({terminal})),f=await fixture(200,{}, {start});
 const result=await f.provider.generateImage('prompt',undefined,context);expect(result.delivery).toBe('inline');
 await expect(f.provider.generateImage('prompt',undefined,context)).rejects.toThrow();
 expect(f.paid).toHaveBeenCalledOnce();expect(start).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();
});
it('in-flight cancellation after actual HTTP retains one failed receipt and does not retry',async()=>{
 const controller=new AbortController(),terminal=vi.fn(async(_input:Parameters<Awaited<ReturnType<ImageRequestAccounting["start"]>>["terminal"]>[0])=>{}),start=vi.fn(async()=>({terminal})),f=await fixture(200,{}, {start});
 f.paid.mockImplementation(()=>controller.abort());
 await expect(f.provider.generateImage('prompt',controller.signal,context)).rejects.toThrow();
 expect(f.paid).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',usage:{}});
});
it('unavailable/foreign ownership cannot create a durable start',async()=>{
 const query=vi.fn(async(_sql:string)=>({rows:[]})),db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>work({query})};
 await expect(new PgImageRequestAccounting(db as never).start(context,{requestId:'foreign',modelId:'fixed-image',startedAt:new Date().toISOString()})).rejects.toThrow('IMAGE_ACCOUNTING_OWNER_DENIED');
 expect(query.mock.calls.every(c=>!(c[0] as unknown as string).includes('INSERT'))).toBe(true);
});
