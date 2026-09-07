import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import type {AsrProviderPort,AsrTranscript} from '../../src/application/recording/asr-ports';
import type {ImageSession} from '../../src/application/agent-run/standard-image-tools';
import {toOrgId} from '../../src/domain/org-id';
import {DefaultStandardAudioService} from '../../src/infrastructure/agent-run/standard-audio-service';
import {ConfiguredRealtimeAsrProvider} from '../../src/infrastructure/recording/configured-realtime-asr-provider';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const workspace=join(process.cwd(),'../..');
const evidenceDir=process.env.WX_ASR_REAL_EVIDENCE!;
const fixturePath=join(workspace,'apps/api/tests/fixtures/audio/s016-bilingual.wav');

function wavPcm16Mono(bytes:Buffer):Buffer{
  const marker=bytes.indexOf(Buffer.from('data'));
  if(marker<0)throw new Error('fixture_data_chunk_missing');
  const length=bytes.readUInt32LE(marker+4),pcm=bytes.subarray(marker+8,marker+8+length);
  if(pcm.length!==length)throw new Error('fixture_data_chunk_truncated');
  return pcm;
}

it('transcribes the fixed bilingual WAV through the configured vendor and records bounded evidence',async()=>{
  const wav=await readFile(fixturePath),pcm=wavPcm16Mono(wav),durationMs=Math.ceil(pcm.length/2/16000*1000);
  expect(durationMs).toBe(8351);
  const sourceHash=hash(wav),source={attachmentId:'s016-bilingual',filename:'s016-bilingual.wav',path:'/inputs/fixed/s016-bilingual.wav',digest:sourceHash,sizeBytes:wav.length,mediaType:'audio/wav'};
  const chunkPath=`/workspace/audio-${sourceHash}-0.pcm`,files=new Map<string,Buffer>([[chunkPath,pcm]]),receipts:Array<Pick<AsrTranscript,'itemId'|'eventId'|'text'>>=[];
  const configured=new ConfiguredRealtimeAsrProvider();
  expect(configured.isConfigured()).toBe(true);
  const provider:AsrProviderPort={
    modelRef:configured.modelRef,
    isConfigured:()=>configured.isConfigured(),
    open:(handlers,audio,options)=>configured.open({...handlers,onFinal:(transcript)=>{receipts.push({itemId:transcript.itemId,eventId:transcript.eventId,text:transcript.text});handlers.onFinal(transcript);}},audio,options),
  };
  const context={orgId:toOrgId(`s016-${randomUUID()}`),parentRunId:`run-${randomUUID()}`,attemptId:'attempt-0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'wx-audio-transcribe-live'};
  const owner={resolve:async()=>({inputs:[source]})},inputs={read:async()=>({manifest:[source],files:[]})};
  const session={
    execute:async(input:{executionId:string})=>({executionId:input.executionId,exitCode:0,output:JSON.stringify([{path:chunkPath,startMs:0,endMs:durationMs,sizeBytes:pcm.length,frames:pcm.length/2,sha256:hash(pcm)}]),timedOut:false,truncated:false,cancelled:false}),
    read:async(path:string)=>{const bytes=files.get(path);if(!bytes)throw new Error('file_missing');return{path,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')};},
    write:async(file:{path:string;contentBase64:string})=>{files.set(file.path,Buffer.from(file.contentBase64,'base64'));},
  };
  const objects=new Map<string,Buffer>();
  const objectStore={putOnce:async(key:string,value:Uint8Array)=>{if(objects.has(key))throw new Error('unexpected_duplicate');objects.set(key,Buffer.from(value));},get:async(key:string)=>objects.get(key)??null,head:async(key:string)=>{const value=objects.get(key);return value?{sizeBytes:value.length}:null;}};
  const service=new DefaultStandardAudioService(owner as never,inputs as never,()=>session as ImageSession,{check:async()=>({allowed:true})} as never,{findOrganization:async()=>({kind:'organization'})} as never,objectStore as never,provider);
  const result=await service.transcribe(context,{attachmentId:source.attachmentId});
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toMatchObject({startMs:0,endMs:durationMs});
  expect(result.segments[0]!.text).toMatch(/[\p{Script=Han}]/u);
  expect(result.segments[0]!.text).toMatch(/[A-Za-z]/);
  expect(result.warnings).toContain('speaker_identity_unavailable');
  expect(receipts.length).toBeGreaterThan(0);
  expect(receipts.some(receipt=>receipt.itemId||receipt.eventId)).toBe(true);
  const artifact=files.get(result.workspacePath);expect(artifact).toBeDefined();expect(hash(artifact!)).toBe(result.sha256);
  await mkdir(evidenceDir,{recursive:true});
  await writeFile(join(evidenceDir,'bilingual-transcript.json'),artifact!);
  await writeFile(join(evidenceDir,'02-vendor-result.json'),JSON.stringify({provider:process.env.KERNEL_ASR_PROVIDER,model:process.env.KERNEL_ASR_MODEL,fixture:{sha256:sourceHash,durationMs,sizeBytes:wav.length},vendorReceipts:receipts.map(({itemId,eventId})=>({itemId:itemId??null,eventId:eventId??null})),segments:result.segments,warnings:result.warnings,artifact:{path:result.workspacePath,sha256:result.sha256,sizeBytes:artifact!.length}},null,2));
},120000);
