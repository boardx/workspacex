import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';
import {afterEach,it,expect,vi} from 'vitest';
import {ConfiguredRealtimeAsrProvider,queuedPcmDurationMs} from '../../src/infrastructure/recording/configured-realtime-asr-provider';
import {PgRecordingUnitOfWork} from '../../src/infrastructure/recording/pg-recording-repository';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgAsrRequestAccounting} from '../../src/infrastructure/auth/pg-asr-request-accounting';
import {toOrgId} from '../../src/domain/org-id';
import type {AsrRequestAccounting} from '../../src/application/recording/asr-request-accounting';
const context={kind:'run' as const,orgId:toOrgId('asr-org'),runId:'run',attemptId:'run:0',leaseEpoch:1};
const audio={sampleRate:16000,channels:1,encoding:'pcm16le'},handlers={onPartial:()=>{},onFinal:()=>{},onError:()=>{},onClosed:()=>{}};
let server:Server|undefined,wss:WebSocketServer|undefined;
afterEach(async()=>{if(wss){for(const c of wss.clients)c.terminate();await new Promise<void>(r=>wss!.close(()=>r()));wss=undefined;}if(server){await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}});
async function fixture(accounting:AsrRequestAccounting,quota=false,rejectHandshake=false){
 const connected=vi.fn();server=createServer();wss=new WebSocketServer({server,verifyClient:()=>!rejectHandshake});wss.on('connection',ws=>{connected();ws.on('message',raw=>{if(JSON.parse(String(raw)).type==='session.finish')ws.send(JSON.stringify({type:'session.finished'}));});});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
 return {connected,provider:new ConfiguredRealtimeAsrProvider({provider:'actual-asr',baseUrl:`ws://127.0.0.1:${(server.address() as AddressInfo).port}`,apiKey:'fixture-secret',model:'fixed-asr'},accounting,quota)};
}
it('missing trusted context and denied durable start open zero upstream WebSockets',async()=>{
 const start=vi.fn(async()=>{throw new Error('denied');}),f=await fixture({start});
 await expect(f.provider.open(handlers,audio)).rejects.toThrow('ASR_ACCOUNTING_CONTEXT_REQUIRED');
 await expect(f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context})).rejects.toThrow('denied');expect(f.connected).not.toHaveBeenCalled();
});
it('actual WebSocket has one persistent start before handshake and one terminal with transport duration estimate',async()=>{
 const terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn<AsrRequestAccounting['start']>(async()=>({terminal})),f=await fixture({start});f.connected.mockImplementation(()=>expect(start).toHaveBeenCalledOnce());
 const session=await f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context});session.pushAudio(new Uint8Array(1600));await session.finish();session.abort();
 expect(f.connected).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'succeeded',queuedDurationMs:50n});
 expect(start.mock.calls[0]?.[1]).toMatchObject({modelProvider:'actual-asr',modelId:'fixed-asr'});expect(JSON.stringify(start.mock.calls)).not.toContain('fixture-secret');
});
it('unimplemented native admission is zero-start and zero-WebSocket',async()=>{
 const start=vi.fn(async()=>({terminal:vi.fn(async()=>{})})),f=await fixture({start},true);await expect(f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context})).rejects.toThrow('ASR_NATIVE_ADMISSION_REQUIRED');expect(start).not.toHaveBeenCalled();expect(f.connected).not.toHaveBeenCalled();
});
it('duration estimate retains format boundaries and is not a vendor bill or Token conversion',()=>{
 expect(queuedPcmDurationMs(1601,audio)).toBe(51n);expect(queuedPcmDurationMs(1600,{...audio,encoding:'unknown'})).toBeNull();
});
it('foreign/stale original owner denies before sole-ledger start',async()=>{
 const query=vi.fn(async(_sql:string)=>({rows:[]})),db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>work({query})};await expect(new PgAsrRequestAccounting(db as never).start(context,{requestId:'ws-id',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()})).rejects.toThrow('ASR_ACCOUNTING_OWNER_DENIED');expect(query.mock.calls.every(c=>!c[0].includes('INSERT'))).toBe(true);
});
it('cancel after start but before constructing the WebSocket writes failed terminal without connection',async()=>{
 const controller=new AbortController(),terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn(async()=>{controller.abort();return {terminal};}),f=await fixture({start});
 await expect(f.provider.open(handlers,audio,{turnDetection:'manual',signal:controller.signal,accountingContext:context})).rejects.toThrow();expect(f.connected).not.toHaveBeenCalled();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',queuedDurationMs:0n});
});
it('inflight abort settles once with queued duration, no new session or retry',async()=>{
 let done!:()=>void;const settled=new Promise<void>(r=>done=r),terminal=vi.fn(async(_input:unknown)=>done()),start=vi.fn(async()=>({terminal})),f=await fixture({start});
 const controller=new AbortController(),session=await f.provider.open(handlers,audio,{turnDetection:'manual',signal:controller.signal,accountingContext:context});session.pushAudio(new Uint8Array(3200));controller.abort();await settled;session.abort();
 expect(f.connected).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',queuedDurationMs:100n});
});
it('terminal outage preserves successful ASR finish and blocks later actual WebSocket',async()=>{
 const terminal=vi.fn(async()=>{throw new Error('ledger unavailable');}),start=vi.fn(async()=>({terminal})),f=await fixture({start});
 const session=await f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context});session.pushAudio(new Uint8Array(3200));await session.finish();
 await expect(f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context})).rejects.toThrow('ASR_ACCOUNTING_REPAIR_REQUIRED');expect(f.connected).toHaveBeenCalledOnce();expect(terminal).toHaveBeenCalledOnce();session.abort();
});
it('personal capture authority is checked by the existing repository with exact capture, no content read',async()=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT 1 FROM recording_sessions')?[{allowed:1}]:[]})),db={withTenant:async(org:unknown,work:(s:unknown)=>unknown)=>{expect(org).toBe(context.orgId);return work({query});}};
 const personal={kind:'personal-capture' as const,orgId:context.orgId,ownerUserId:'original',transcriptionId:'personal',captureId:'exact-capture'};
 const receipt=await new PgAsrRequestAccounting(db as never).start(personal,{requestId:'ws-personal',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()});await receipt.terminal({endedAt:new Date().toISOString(),outcome:'failed',queuedDurationMs:50n});
 const capture=query.mock.calls.find(c=>c[0].includes('SELECT 1 FROM recording_sessions')) as unknown as [string,unknown[]];expect(capture[1]).toEqual(['personal',context.orgId,'original','exact-capture']);expect(capture[0]).toContain('FOR SHARE OF p,rs');
 const write=query.mock.calls.find(c=>c[0].includes('INTO token_usage_events')) as unknown as [string,unknown[]];expect(write[1][2]).toBe('original');expect(write[1][3]).toBeNull();expect(write[1].slice(24)).toEqual(['millisecond','50','estimated']);expect(write[1][10]).toBe('unknown');
});

it('rejected actual vendor handshake has one failed terminal and no automatic reconnect',async()=>{
 const terminal=vi.fn(async(_input:unknown)=>{}),start=vi.fn(async()=>({terminal})),f=await fixture({start},false,true),attempts=vi.fn();server!.on('upgrade',attempts);
 await expect(f.provider.open(handlers,audio,{turnDetection:'manual',accountingContext:context})).rejects.toThrow();expect(attempts).toHaveBeenCalledOnce();expect(start).toHaveBeenCalledOnce();expect(terminal.mock.calls[0]?.[0]).toMatchObject({outcome:'failed',queuedDurationMs:0n});
});
it('draft/project original principal is reauthorized and denied membership never starts ledger',async()=>{
 const query=vi.fn(async(_sql:string)=>({rows:[]})),db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>work({query})};
 const repo={findOrgMembership:vi.fn(async()=>({})),findProjectMembership:vi.fn(async()=>({}))};
 const lifecycleSession=vi.fn(async()=>({projectId:'project',endedAt:null})),uow={withOrg:async(_org:unknown,_actor:unknown,work:(s:unknown)=>unknown)=>work({sessions:{lockedLifecycleSession:lifecycleSession}})};
 const accounting=new PgAsrRequestAccounting(db as never,()=>({identities:repo as never,recording:uow as never}));
 const receipt=await accounting.start({kind:'recording',orgId:context.orgId,userId:'actual-principal',sessionId:'active'},{requestId:'recording-ws',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()});
 await receipt.terminal({endedAt:new Date().toISOString(),outcome:'failed',queuedDurationMs:null});expect(repo.findProjectMembership).toHaveBeenCalledWith('actual-principal','project',context.orgId);
 const write=query.mock.calls.find(c=>c[0].includes('INTO token_usage_events')) as unknown as [string,unknown[]];expect(write[1][2]).toBe('actual-principal');expect(write[1][11]).toBe('project');
 repo.findOrgMembership.mockResolvedValueOnce(null as never);await expect(accounting.start({kind:'draft',orgId:context.orgId,userId:'outsider'},{requestId:'denied-draft',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()})).rejects.toThrow('ASR_ACCOUNTING_OWNER_DENIED');
 expect(query.mock.calls.filter(c=>c[0].includes('INTO model_request_starts'))).toHaveLength(1);
 lifecycleSession.mockResolvedValueOnce({projectId:'project',endedAt:'ended'} as never);await expect(accounting.start({kind:'recording',orgId:context.orgId,userId:'actual-principal',sessionId:'ended'},{requestId:'ended-ws',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()})).rejects.toThrow();
});

it('real repositories reuse one tenant connection and lifecycle lock precedes durable start',async()=>{
 const queries:string[]=[];let physicalConnections=0,locked=false;
 const query=async(sql:string)=>{queries.push(sql);if(sql.includes('FROM recording_sessions')){expect(sql).toContain('FOR SHARE');locked=true;return {rows:[{id:'active',project_id:'project',source_type:'meeting',source_ref_id:'source',started_at:new Date().toISOString(),ended_at:null,duration_ms:null,materialize_job_id:null,retention_days:7,retention_from:'org',expires_at:new Date().toISOString(),live_duration_ms:'0'}]};}
 if(sql.includes('INTO model_request_starts')){expect(locked).toBe(true);return {rows:[]};}
 return {rows:[{role:'member',user_id:'principal',org_id:context.orgId,project_id:'project'}]};};
 const db={withTenant:async(_org:unknown,work:(s:unknown)=>unknown)=>{physicalConnections++;try{return await work({query});}finally{locked=false;}}};
 const accounting=new PgAsrRequestAccounting(db as never,scoped=>({identities:new PgIdentityRepository(scoped),recording:new PgRecordingUnitOfWork(scoped,{} as never,{} as never)}));
 await accounting.start({kind:'recording',orgId:context.orgId,userId:'principal',sessionId:'active'},{requestId:'single-connection',modelProvider:'p',modelId:'m',startedAt:new Date().toISOString()});
 expect(physicalConnections).toBe(1);expect(queries.filter(sql=>sql.includes('INTO model_request_starts'))).toHaveLength(1);expect(locked).toBe(false);
});
