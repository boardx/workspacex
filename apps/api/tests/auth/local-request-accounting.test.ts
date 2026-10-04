import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,it,expect,vi} from 'vitest';
import {HttpLocalModelRuntime,readLocalUsage} from '../../src/infrastructure/identity/http-local-model-runtime';
import {PgLocalRequestAccounting} from '../../src/infrastructure/auth/pg-local-request-accounting';
import {invokeLocalModel} from '../../src/application/identity/invoke-local-model';
import {toOrgId} from '../../src/domain/org-id';
import type {LocalRequestAccounting} from '../../src/application/identity/local-request-accounting';
import type {TokenUsageMeterPort} from '../../src/application/agent-run/ports';
const context={orgId:toOrgId('local-org'),userId:'principal',capabilityId:'capability'};
let server:http.Server|undefined;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}});
async function fixture(body:unknown,accounting:LocalRequestAccounting,status=200,quota=false){
 const seen=vi.fn();server=http.createServer((req,res)=>{seen(req.method);res.statusCode=status;res.end(JSON.stringify(body));});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 return {seen,runtime:new HttpLocalModelRuntime(`http://127.0.0.1:${(server.address() as AddressInfo).port}`,'real-local-binding',accounting,quota)};
}
it('probe is not an inference receipt; actual POST stores original reported counters without guessed total/price',async()=>{
 const terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn(async()=>({terminal}));const f=await fixture({response:'answer',prompt_eval_count:5,eval_count:3},{start});
 await f.runtime.probe();expect(start).not.toHaveBeenCalled();f.seen.mockImplementation((method)=>{if(method==='POST')expect(start).toHaveBeenCalledOnce();});
 expect(await f.runtime.complete('private prompt',context)).toBe('answer');expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'succeeded',usage:{prompt:5,completion:3}});
 expect(JSON.stringify(start.mock.calls)).not.toContain('private prompt');expect(JSON.stringify(terminal.mock.calls)).not.toContain('answer');
});
it('missing owner, start denial and pending admission dispatch no model HTTP',async()=>{
 const start=vi.fn(async()=>{throw new Error('denied');}),f=await fixture({response:'answer'},{start});
 await expect(f.runtime.complete('prompt')).rejects.toThrow('LOCAL_ACCOUNTING_CONTEXT_REQUIRED');await expect(f.runtime.complete('prompt',context)).rejects.toThrow('denied');expect(f.seen).not.toHaveBeenCalled();
});
it('product quota without local admission is a zero-start/zero-HTTP hard stop',async()=>{
 const start=vi.fn(async()=>({terminal:vi.fn(async()=>{})})),f=await fixture({}, {start},200,true);
 await expect(f.runtime.complete('prompt',context)).rejects.toThrow('LOCAL_MODEL_ADMISSION_REQUIRED');expect(start).not.toHaveBeenCalled();expect(f.seen).not.toHaveBeenCalled();
});
it('provider failure writes one failed receipt including original reported counters, no retry',async()=>{
 const terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn(async()=>({terminal})),f=await fixture({error:'unavailable',eval_count:2},{start},503);
 await expect(f.runtime.complete('prompt',context)).rejects.toThrow('local runtime error');expect(f.seen).toHaveBeenCalledOnce();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',usage:{completion:2}});
});
it('inflight cancellation has one failed terminal and terminal outage preserves output then stops next inference',async()=>{
 const terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn(async()=>({terminal})),f=await fixture({response:'answer'},{start});const controller=new AbortController();
 f.seen.mockImplementation(()=>controller.abort());await expect(f.runtime.complete('prompt',{...context,signal:controller.signal})).rejects.toThrow();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',usage:{}});expect(f.seen).toHaveBeenCalledOnce();
 f.seen.mockImplementation(()=>{});terminal.mockRejectedValueOnce(new Error('ledger unavailable'));expect(await f.runtime.complete('prompt',context)).toBe('answer');
 await expect(f.runtime.complete('prompt',context)).rejects.toThrow('LOCAL_ACCOUNTING_REPAIR_REQUIRED');expect(f.seen).toHaveBeenCalledTimes(2);
});
it('server use case forwards only its checked principal/org/capability and rejects outsider before any probe',async()=>{
 const complete=vi.fn(async()=> 'answer'),probe=vi.fn(async()=>({available:true,detail:'ok'})),repo={findOrgMembership:vi.fn(async()=>({})),findOrganization:vi.fn(async()=>({kind:'personal-local'}))};
 const deps={repo,capabilities:{findById:async()=>({facts:{endpoint:'http://127.0.0.1:1234'}})},runtime:{endpoint:'http://127.0.0.1:1234',complete,probe},egress:{runLocalOnly:async(_org:unknown,work:()=>Promise<unknown>)=>work()}};
 await invokeLocalModel(deps as never,{...context,prompt:'prompt'});expect(complete).toHaveBeenCalledWith('prompt',context);
 repo.findOrgMembership.mockResolvedValueOnce(null as never);await expect(invokeLocalModel(deps as never,{...context,userId:'outsider',prompt:'prompt'})).rejects.toThrow();expect(probe).toHaveBeenCalledOnce();expect(complete).toHaveBeenCalledOnce();
});
it('membership is rechecked before sole-ledger start; non-run trial keeps run null, unknown totals and no free cost',async()=>{
 const repo={findOrgMembership:vi.fn(async()=>({})),findOrganization:vi.fn(async()=>({kind:'personal-local'}))},startRequest=vi.fn(async()=>{}),record=vi.fn<TokenUsageMeterPort['record']>(async()=>{}),accounting=new PgLocalRequestAccounting(repo as never,{startRequest,record});
 const receipt=await accounting.start(context,{requestId:'local-http',modelId:'actual-local',startedAt:new Date().toISOString()});await receipt.terminal({endedAt:new Date().toISOString(),outcome:'succeeded',usage:{prompt:5,completion:3}});
 expect(startRequest).toHaveBeenCalledWith(context.orgId,expect.objectContaining({userId:'principal',runId:null,executionAttemptId:null,callPurpose:'local-trial'}));expect(record).toHaveBeenCalledWith(context.orgId,expect.objectContaining({eventId:'local-http',runId:null,totalSource:'unknown',tokensTotal:0,promptTokens:5,completionTokens:3}));expect(record.mock.calls[0]?.[1]).not.toHaveProperty('costMicros');
 repo.findOrgMembership.mockResolvedValueOnce(null as never);await expect(accounting.start(context,{requestId:'denied',modelId:'actual-local',startedAt:new Date().toISOString()})).rejects.toThrow();expect(startRequest).toHaveBeenCalledOnce();
});
it('malformed local counters stay absent, not rounded or converted into invented total',()=>{
 expect(readLocalUsage('{"eval_count":-1,"prompt_eval_count":2.5}')).toEqual({});expect(readLocalUsage('bad')).toEqual({});
});
