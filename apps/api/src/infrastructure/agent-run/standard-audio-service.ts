import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {z} from 'zod';
import {AudioTranscribeInput,AudioTranscribed,AUDIO_TRANSCRIBE_TOOL,AUDIO_TRANSCRIBE_LIMITS as L} from '@repo/contracts/standard-audio-tools';
import {schemas} from '@repo/contracts/sandbox-session';
import type {NativeSessionOwner,NativeResolved} from '../../application/agent-run/native-session-owner';
import type {NativeRunInputs} from '../../application/agent-run/native-run-inputs';
import type {ImageSession} from '../../application/agent-run/standard-image-tools';
import type {AudioContext,StandardAudioService} from '../../application/agent-run/standard-audio-tools';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import type {AsrProviderPort} from '../../application/recording/asr-ports';
import type {IdentityRepository} from '../../application/identity/ports';
import {ObjectExistsError,type ObjectStore} from '../../application/artifact/ports';
import {isLocalOrg} from '../../domain/identity/local-org';
import {decodeWav} from './audio-wav-decoder';
import {transcribeAudioChunk} from './audio-asr-chunk';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
export class DefaultStandardAudioService implements StandardAudioService {
 constructor(private owner:NativeSessionOwner,private inputs:NativeRunInputs,private sessions:(bound:NativeResolved)=>ImageSession,private authority:Pick<ToolExecutionAuthority,'check'>,private identities:Pick<IdentityRepository,'findOrganization'>,private objects:ObjectStore,private provider:AsrProviderPort){}
 async transcribe(context:AudioContext,raw:z.infer<typeof AudioTranscribeInput>){
  const input=AudioTranscribeInput.parse(raw),signal=AbortSignal.timeout(L.deadlineMs);
  const authorize=async()=>{signal.throwIfAborted();if(!(await this.authority.check({...context,toolName:AUDIO_TRANSCRIBE_TOOL,toolArgs:input})).allowed)throw new Error('audio_transcription_denied');};
  await authorize();const bound=await this.owner.resolve(context.bindingId,context),session=this.sessions(bound);
  const org=await this.identities.findOrganization(context.orgId);if(!org||isLocalOrg(org.kind))throw new Error('audio_egress_denied');
  const source=bound.inputs.find(f=>f.attachmentId===input.attachmentId);
  if(!source)throw new Error('audio_source_denied');
  const checkSource=async()=>{const current=await this.inputs.read(context),actual=current.manifest.find(f=>f.attachmentId===input.attachmentId);if(!actual||actual.digest!==source.digest||actual.sizeBytes!==source.sizeBytes||actual.path!==source.path)throw new Error('audio_source_changed_or_denied');};
  await checkSource();
  if(input.diarization===true||input.language!==undefined)throw new Error('audio_mode_unsupported');
  if(!this.provider.isConfigured()||!this.provider.modelRef)throw new Error('audio_provider_unavailable');
  if(!['audio/wav','audio/x-wav','audio/wave','audio/mpeg'].includes(source.mediaType))throw new Error('audio_format_unsupported');
  const identityInput={attachmentId:input.attachmentId};
  const requestKey=hash(JSON.stringify(identityInput)),prefix=`audio-transcription/${hash(context.orgId)}/${hash(context.parentRunId)}/${requestKey}`;
  const intent=Buffer.from(JSON.stringify({input:identityInput,sourceHash:source.digest,modelRef:this.provider.modelRef}));
  await authorize();await this.owner.resolve(context.bindingId,context);
  let created=false;try{await this.objects.putOnce(`${prefix}/intent.json`,intent,'application/json');created=true;}catch(e){if(!(e instanceof ObjectExistsError))throw e;}
  const savedIntent=await this.objects.get(`${prefix}/intent.json`);if(!savedIntent||!Buffer.from(savedIntent).equals(intent))throw new Error('audio_idempotency_conflict');
  const workspacePath=`/workspace/transcribed-${requestKey}.json`;
  let receipt:z.infer<typeof AudioTranscribed>,bytes:Uint8Array;
  if(created){
   const decoded=await decodeWav(session,source.path,source.digest);
   const segments:z.infer<typeof AudioTranscribed>['segments']=[];
   const stop=new AbortController(),cancel=new AbortController();
   const watch=(async()=>{try{while(true){await delay(1000,undefined,{signal:stop.signal});await this.owner.resolve(context.bindingId,context);}}catch{if(!stop.signal.aborted)cancel.abort();}})();
   // Session file operations are exclusive. Only ASR sessions run concurrently;
   // at most `concurrency` workers can wait for this bounded read sequence.
   let readTail:Promise<unknown>=Promise.resolve();
   const readChunk=(chunk:(typeof decoded.chunks)[number])=>{const result=readTail.then(()=>decoded.read(chunk));readTail=result.catch(()=>{});return result;};
   let next=0,firstError:unknown;
   const worker=async()=>{
    while(!cancel.signal.aborted){
     const index=next++,chunk=decoded.chunks[index];if(!chunk)return;
     try{
      await authorize();await checkSource();await this.owner.resolve(context.bindingId,context);
      const pcm=await readChunk(chunk),text=await transcribeAudioChunk(this.provider,pcm,AbortSignal.any([signal,cancel.signal]));
      segments[index]={id:`chunk-${index}`,startMs:chunk.startMs,endMs:chunk.endMs,text};
     }catch(error){firstError??=error;cancel.abort();throw error;}
    }
   };
   try{await Promise.allSettled(Array.from({length:Math.min(L.concurrency,decoded.chunks.length)},worker));
    if(firstError)throw firstError;
    signal.throwIfAborted();if(cancel.signal.aborted||segments.length!==decoded.chunks.length||segments.some(s=>!s))throw new Error('audio_transcription_cancelled');
   }finally{stop.abort();cancel.abort();await watch;}
   const warnings:z.infer<typeof AudioTranscribed>['warnings']=['source_chunk_boundaries_not_word_timestamps','speaker_identity_unavailable','confidence_not_calibrated'];
   if(segments.every(s=>!s.text.trim()))warnings.push('no_recognized_speech');
   else if(segments.some(s=>!s.text.trim()))warnings.push('some_chunks_without_recognized_speech');
   bytes=Buffer.from(JSON.stringify({sourceHash:source.digest,segments,warnings}));
   if(bytes.length>L.maxTextBytes)throw new Error('audio_transcript_too_large');
   receipt=AudioTranscribed.parse({workspacePath,sha256:hash(bytes),sourceHash:source.digest,segments,warnings});
   await this.objects.putOnce(`${prefix}/transcript.json`,bytes,'application/json');
   const saved=await this.objects.get(`${prefix}/transcript.json`);if(!saved||hash(saved)!==receipt.sha256)throw new Error('audio_readback_failed');
   await this.objects.putOnce(`${prefix}/receipt.json`,Buffer.from(JSON.stringify(receipt)),'application/json');
  }else{
   const head=await this.objects.head(`${prefix}/receipt.json`);if(!head||head.sizeBytes>L.maxTextBytes)throw new Error('audio_unknown_outcome_no_resubmit');
   const saved=await this.objects.get(`${prefix}/receipt.json`);if(!saved||saved.length!==head.sizeBytes)throw new Error('audio_result_unavailable');
   receipt=AudioTranscribed.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(saved)));
   const transcriptHead=await this.objects.head(`${prefix}/transcript.json`);if(!transcriptHead||transcriptHead.sizeBytes>L.maxTextBytes)throw new Error('audio_result_unavailable');
   const transcript=await this.objects.get(`${prefix}/transcript.json`);if(!transcript||transcript.length!==transcriptHead.sizeBytes||hash(transcript)!==receipt.sha256)throw new Error('audio_result_unavailable');bytes=transcript;
  }
  if(!Buffer.from(bytes).equals(Buffer.from(JSON.stringify({sourceHash:receipt.sourceHash,segments:receipt.segments,warnings:receipt.warnings}))))throw new Error('audio_result_payload_conflict');
  if(receipt.workspacePath!==workspacePath||receipt.sourceHash!==source.digest)throw new Error('audio_result_invalid');
  await authorize();await checkSource();await this.owner.resolve(context.bindingId,context);
  await session.write({path:workspacePath,contentBase64:Buffer.from(bytes).toString('base64')});
  const file=schemas.file.parse(await session.read(workspacePath));if(file.path!==workspacePath||file.sizeBytes!==bytes.length||file.contentBase64!==Buffer.from(bytes).toString('base64'))throw new Error('audio_readback_failed');
  await authorize();await checkSource();await this.owner.resolve(context.bindingId,context);return receipt;
 }
}
