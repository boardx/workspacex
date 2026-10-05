import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {WebSocketServer} from 'ws';
import {afterEach,it,expect,vi} from 'vitest';
import type {AiAdmissionPort} from '../../src/application/agent-run/ai-admission-ports';
import type {TokenUsageMeterPort} from '../../src/application/agent-run/ports';
import {toOrgId} from '../../src/domain/org-id';
import {ConfiguredRealtimeAsrProvider} from '../../src/infrastructure/recording/configured-realtime-asr-provider';
import {prepareAsrAiAdmission,type AsrNativeAdmissionDependencies,type AsrNativeAdmissionPort,type VerifiedAsrAdmission} from '../../src/infrastructure/recording/bounded-asr-admission';
const context={kind:'run' as const,orgId:toOrgId('actual-org'),runId:'actual-run',attemptId:'actual-run:0',leaseEpoch:1};
const audio={sampleRate:16000,channels:1,encoding:'pcm16le'};
const request={requestId:'physical-audio',modelProvider:'asr-provider',modelId:'runtime-asr',startedAt:'2026-10-05T00:00:00Z',audio};
const verified:VerifiedAsrAdmission={orgId:context.orgId,userId:'actual-initiator',runId:context.runId,sourceRunId:context.runId,subtaskId:null,modelProvider:request.modelProvider,runtimeModelId:request.modelId,executionAttemptId:context.attemptId,executionLeaseEpoch:1,
 projectId:null,threadId:null,agentId:null,formalModelId:'formal-asr',logicalCallId:'logical-capture',windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-11-01T00:00:00Z',
 price:{unit:'millisecond',quantum:1000n,microsPerQuantum:7n,currency:'CNY',version:'verified-v1'},maximumQuantity:50n,bindingVerified:true,tokenBilling:'not-applicable'};
function deps(replacement:VerifiedAsrAdmission|null=verified){
 const reserve=vi.fn<AiAdmissionPort['reserve']>(async()=>({decision:'allowed' as const,replay:false})),settle=vi.fn<AiAdmissionPort['settle']>(async()=>{}),startRequest=vi.fn<NonNullable<TokenUsageMeterPort['startRequest']>>(async()=>{}),record=vi.fn<TokenUsageMeterPort['record']>(async()=>{});
 const dependencies:AsrNativeAdmissionDependencies={admission:{reserve,settle},usage:{startRequest,record},resolve:vi.fn(async()=>replacement)};
 return {...dependencies,dependencies,reserve,settle,startRequest,record};
}
let server:Server|undefined,wss:WebSocketServer|undefined;
afterEach(async()=>{if(wss){for(const c of wss.clients)c.terminate();await new Promise<void>(resolve=>wss!.close(()=>resolve()));wss=undefined;}if(server){await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}});
async function transport(d:AsrNativeAdmissionDependencies|AsrNativeAdmissionPort){
 const connected=vi.fn(),frames:string[]=[],error=vi.fn();server=createServer();wss=new WebSocketServer({server});
 wss.on('connection',ws=>{connected();ws.on('message',raw=>{const event=JSON.parse(String(raw));if(event.type==='input_audio_buffer.append')frames.push(event.audio);if(event.type==='session.finish')ws.send(JSON.stringify({type:'session.finished'}));});});
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const provider=new ConfiguredRealtimeAsrProvider({provider:request.modelProvider,model:request.modelId,apiKey:'not-a-real-key',baseUrl:`ws://127.0.0.1:${(server.address() as AddressInfo).port}`},undefined,true,d);
 return {provider,connected,frames,error,handlers:{onPartial:()=>{},onFinal:()=>{},onError:error,onClosed:()=>{}}};
}
it('reserves native finite cost and writes durable start before actual upstream WebSocket; missing supplier usage keeps hold',async()=>{
 const d=deps(),f=await transport(d.dependencies);f.connected.mockImplementation(()=>{expect(d.reserve).toHaveBeenCalledOnce();expect(d.startRequest).toHaveBeenCalledOnce();});
 const session=await f.provider.open(f.handlers,audio,{turnDetection:'manual',accountingContext:context});session.pushAudio(new Uint8Array(1600));await session.finish();session.abort();
 expect(f.connected).toHaveBeenCalledOnce();expect(f.frames).toHaveLength(1);expect(d.record).toHaveBeenCalledOnce();
 expect(d.reserve.mock.calls[0]).toEqual([context.orgId,expect.objectContaining({maximumTokens:0n,maximumCostMicros:1n,priceVersion:'verified-v1',nativePolicy:{unit:'millisecond',maximumQuantity:50n}})]);
 expect(d.record.mock.calls[0]).toEqual([context.orgId,expect.objectContaining({userId:'actual-initiator',outcome:'succeeded',totalSource:'not-applicable',nativeUsage:{unit:'millisecond',quantity:50n,source:'estimated'}})]);
 expect(d.settle).toHaveBeenCalledWith(context.orgId,expect.any(String),{tokens:0n,costMicros:null});
});
it('ceil duration boundary refuses overflowing and partial PCM frames before append, cancels once',async()=>{
 const d=deps(),f=await transport(d.dependencies);const session=await f.provider.open(f.handlers,audio,{turnDetection:'manual',accountingContext:context});
 session.pushAudio(new Uint8Array(1602));session.abort();await vi.waitFor(()=>expect(d.record).toHaveBeenCalledOnce());
 expect(f.frames).toHaveLength(0);expect(f.error).toHaveBeenCalledOnce();expect(d.settle).toHaveBeenCalledOnce();
 expect(d.record.mock.calls[0]).toEqual([context.orgId,expect.objectContaining({outcome:'failed',nativeUsage:{unit:'millisecond',quantity:0n,source:'estimated'}})]);
});
it('cancel after physical PCM append retains native estimate and cost hold, no reconnect',async()=>{
 const d=deps(),f=await transport(d.dependencies);const session=await f.provider.open(f.handlers,audio,{accountingContext:context});
 session.pushAudio(new Uint8Array(800));session.abort();await vi.waitFor(()=>expect(d.settle).toHaveBeenCalledOnce());
 expect(f.connected).toHaveBeenCalledOnce();expect(d.record.mock.calls[0]).toEqual([context.orgId,expect.objectContaining({outcome:'failed',nativeUsage:{unit:'millisecond',quantity:25n,source:'estimated'}})]);
});
it.each(['tenant','run','lease','binding','model','provider','price','format','unconfigured','denied','replay'] as const)('refuses %s before durable start or WebSocket',async mode=>{
 const d=deps(mode==='unconfigured'?null:{...verified,...(mode==='tenant'?{orgId:toOrgId('foreign')}:mode==='run'?{sourceRunId:'foreign-run'}:mode==='lease'?{executionLeaseEpoch:2}:mode==='binding'?{bindingVerified:false as never}:mode==='model'?{runtimeModelId:'unrelated-model'}:mode==='provider'?{modelProvider:'unrelated-provider'}:mode==='price'?{price:{...verified.price,version:''}}:{})});
 if(mode==='denied')d.reserve.mockResolvedValueOnce({decision:'AI_COST_LIMIT_REACHED' as never,replay:false});
 if(mode==='replay')d.reserve.mockResolvedValueOnce({decision:'allowed',replay:true});
 const f=await transport(d.dependencies);
 await expect(f.provider.open(f.handlers,mode==='format'?{...audio,channels:2}:audio,{accountingContext:context})).rejects.toThrow();
 expect(d.startRequest).not.toHaveBeenCalled();expect(f.connected).not.toHaveBeenCalled();
});
it('non-run principal mismatch cannot start a native hold and missing duration is never priced as free',async()=>{
 const d=deps({...verified,runId:null,sourceRunId:null,executionAttemptId:null,userId:'different'});
 await expect(prepareAsrAiAdmission({kind:'draft',orgId:context.orgId,userId:'caller'},request,d.dependencies)).rejects.toThrow('ASR_NATIVE_OWNER_DENIED');expect(d.reserve).not.toHaveBeenCalled();
});

it('child attribution keeps root run plus explicit subtask while validating original source lease',async()=>{
 const d=deps({...verified,runId:'root-run',subtaskId:'actual-child',sourceRunId:context.runId});
 const receipt=await prepareAsrAiAdmission(context,request,d.dependencies);
 await receipt.terminal({endedAt:request.startedAt,outcome:'failed',queuedDurationMs:null});
 expect(d.startRequest).toHaveBeenCalledWith(context.orgId,expect.objectContaining({runId:'root-run',subtaskId:'actual-child'}));
 expect(d.record).toHaveBeenCalledWith(context.orgId,expect.objectContaining({runId:'root-run',subtaskId:'actual-child',nativeUsage:{unit:'millisecond',quantity:null,source:'unknown'}}));
 expect(d.settle).toHaveBeenCalledWith(context.orgId,request.requestId,{tokens:0n,costMicros:null});
});

it('terminal write retry reuses exact receipt and never re-reserves or starts another supplier request',async()=>{
 const d=deps(),receipt=await prepareAsrAiAdmission(context,request,d.dependencies);
 const input={endedAt:request.startedAt,outcome:'failed' as const,queuedDurationMs:4n};
 d.settle.mockRejectedValueOnce(new Error('transient-ledger'));
 await expect(receipt.terminal(input)).rejects.toThrow('transient-ledger');
 await expect(receipt.terminal({...input,queuedDurationMs:5n})).rejects.toThrow('ASR_NATIVE_TERMINAL_REPLAY_MISMATCH');
 await receipt.terminal(input);await receipt.terminal(input);
 expect(d.reserve).toHaveBeenCalledOnce();expect(d.startRequest).toHaveBeenCalledOnce();expect(d.record).toHaveBeenCalledTimes(2);expect(d.settle).toHaveBeenCalledTimes(2);
 await expect(receipt.terminal({...input,outcome:'succeeded'})).rejects.toThrow('ASR_NATIVE_TERMINAL_REPLAY_MISMATCH');
});

it('composition start port injects transaction ownership without duplicating legacy starts',async()=>{
 const d=deps(),start=vi.fn<AsrNativeAdmissionPort['start']>((authority,input)=>prepareAsrAiAdmission(authority,input,d.dependencies));
 const f=await transport({start}),session=await f.provider.open(f.handlers,audio,{turnDetection:'manual',accountingContext:context});
 await session.finish();
 expect(start).toHaveBeenCalledOnce();expect(start.mock.calls[0]?.[0]).toEqual(context);
 expect(d.reserve).toHaveBeenCalledOnce();expect(d.startRequest).toHaveBeenCalledOnce();expect(f.connected).toHaveBeenCalledOnce();
});

it('provider finish retries only failed immutable accounting terminal after transport closes',async()=>{
 const d=deps(),f=await transport(d.dependencies);d.settle.mockRejectedValueOnce(new Error('temporary-write'));
 const session=await f.provider.open(f.handlers,audio,{turnDetection:'manual',accountingContext:context});
 await session.finish();await vi.waitFor(()=>expect(d.settle).toHaveBeenCalledTimes(1));
 await session.finish();
 expect(d.settle).toHaveBeenCalledTimes(2);expect(d.record.mock.calls[0]).toEqual(d.record.mock.calls[1]);
 expect(f.connected).toHaveBeenCalledOnce();expect(d.reserve).toHaveBeenCalledOnce();expect(d.startRequest).toHaveBeenCalledOnce();
});
