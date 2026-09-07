import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DefaultStandardAudioService} from '../../src/infrastructure/agent-run/standard-audio-service';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import type {AsrProviderPort} from '../../src/application/recording/asr-ports';
import type {ImageSession} from '../../src/application/agent-run/standard-image-tools';
import {toOrgId} from '../../src/domain/org-id';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const context={orgId:toOrgId('audio-org'),parentRunId:'run',attemptId:'run:0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'call'};
const args={attachmentId:'original'};
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'wx-audio-'));roots.push(root);const objects=new FsObjectStore(root),files=new Map<string,Buffer>();
 const source={attachmentId:'original',filename:'original.wav',path:'/inputs/fixed/original.wav',digest:hash('source'),sizeBytes:6,mediaType:'audio/wav'};
 const owner={resolve:vi.fn(async()=>({inputs:[source]}))},inputs={read:vi.fn(async()=>({manifest:[source],files:[]}))};
 const pcm=Buffer.alloc(32000),chunk={path:`/workspace/audio-${source.digest}-0.pcm`,startMs:0,endMs:1000,sizeBytes:pcm.length,frames:16000,sha256:hash(pcm)};files.set(chunk.path,pcm);
 const session={read:vi.fn(async(path:string)=>({path,sizeBytes:files.get(path)!.length,contentBase64:files.get(path)!.toString('base64')})),write:vi.fn(async(f:{path:string;contentBase64:string})=>{files.set(f.path,Buffer.from(f.contentBase64,'base64'));}),execute:vi.fn<ImageSession['execute']>(async e=>({executionId:e.executionId,exitCode:0,output:JSON.stringify([chunk]),timedOut:false,truncated:false,cancelled:false}))};
 const authority={check:vi.fn(async()=>({allowed:true}))},identities={findOrganization:vi.fn(async()=>({kind:'organization'}))};
 const intent=`audio-transcription/${hash(context.orgId)}/${hash(context.parentRunId)}/${hash(JSON.stringify(args))}/intent.json`;
 const provider={modelRef:'actual-fixture-model',isConfigured:()=>true,open:vi.fn<AsrProviderPort['open']>(async handlers=>{expect(await objects.get(intent)).not.toBeNull();return{pushAudio:()=>{},commit:()=>{},abort:()=>{},finish:async()=>{handlers.onFinal({itemId:'1',eventId:'1',text:'你好 hello',confidence:null});}};})};
 const service=()=>new DefaultStandardAudioService(owner as never,inputs,()=>session,authority as never,identities as never,objects,provider);
 return{source,owner,inputs,session,authority,identities,provider,service};
}
it('durably records intent before ASR and replays exact JSON without duplicate remote transcription',async()=>{
 const f=await setup(),out=await f.service().transcribe(context,args);expect(out.segments).toEqual([{id:'chunk-0',startMs:0,endMs:1000,text:'你好 hello'}]);expect(out).not.toHaveProperty('transcriptId');
 expect(await f.service().transcribe({...context,toolCallId:'new-call'},args)).toEqual(out);expect(await f.service().transcribe({...context,toolCallId:'explicit-default'},{...args,diarization:false})).toEqual(out);expect(f.provider.open).toHaveBeenCalledTimes(1);
});
it('does not resubmit unknown provider outcomes',async()=>{
 const f=await setup();f.provider.open.mockRejectedValueOnce(new Error('ack lost'));await expect(f.service().transcribe(context,args)).rejects.toThrow();await expect(f.service().transcribe(context,args)).rejects.toThrow('unknown_outcome');expect(f.provider.open).toHaveBeenCalledTimes(1);
});
it('denies changed source/current ACL and unsupported modes before external audio',async()=>{
 const f=await setup();f.inputs.read.mockRejectedValueOnce(new Error('visibility revoked'));await expect(f.service().transcribe(context,args)).rejects.toThrow('visibility');
 await expect(f.service().transcribe(context,{...args,diarization:true})).rejects.toThrow('unsupported');
 await expect(f.service().transcribe(context,{...args,language:'zh'})).rejects.toThrow('unsupported');expect(f.provider.open).not.toHaveBeenCalled();
});
it('late workspace write cancellation cannot confirm a transcript',async()=>{
 const f=await setup(),write=f.session.write.getMockImplementation()!;f.session.write.mockImplementation(async input=>{await write(input);f.owner.resolve.mockRejectedValue(new Error('cancelled'));});await expect(f.service().transcribe(context,args)).rejects.toThrow();
});
it('a provider-confirmed silent result remains empty and explicitly warned',async()=>{
 const f=await setup();f.provider.open.mockImplementation(async()=>({pushAudio:()=>{},commit:()=>{},abort:()=>{},finish:async()=>{}}));
 const out=await f.service().transcribe(context,args);expect(out.segments[0]?.text).toBe('');expect(out.warnings).toContain('no_recognized_speech');
});
