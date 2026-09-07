import {recording} from '@repo/contracts';
import type {AsrProviderPort,AsrSession} from '../../application/recording/asr-ports';
import {AudioFinalCollector} from '../../application/agent-run/audio-final-collector';
/** Uses the existing provider, one explicit manual turn per source chunk. */
export async function transcribeAudioChunk(provider:AsrProviderPort,bytes:Uint8Array,signal:AbortSignal):Promise<string>{
 signal.throwIfAborted();
 const collector=new AudioFinalCollector();let session:AsrSession|undefined,settled=false;
 let fail:(e:Error)=>void=()=>{};
 const failed=new Promise<never>((_,reject)=>{fail=reject;});
 const abort=()=>{session?.abort();fail(new Error('audio_transcription_cancelled'));};
 signal.addEventListener('abort',abort,{once:true});
 const work=(async()=>{
  session=await provider.open({onPartial:()=>{},onFinal:t=>{try{collector.add(t);}catch{fail(new Error('audio_final_identity_ambiguous'));}},onError:()=>fail(new Error('audio_provider_unavailable')),onClosed:()=>{}},recording.ASR_AUDIO_FORMAT,{turnDetection:'manual',signal});
  if(settled||signal.aborted){session.abort();throw new Error('audio_transcription_cancelled');}
  // Bound each append to 80ms PCM, matching existing realtime frame aggregation.
  const frameBytes=recording.ASR_AUDIO_FORMAT.sampleRate*2*80/1000;
  for(let offset=0;offset<bytes.length;offset+=frameBytes){signal.throwIfAborted();session.pushAudio(bytes.subarray(offset,offset+frameBytes));}
  await session.finish();signal.throwIfAborted();return collector.text();
 })();
 try{return await Promise.race([work,failed]);}
 finally{settled=true;signal.removeEventListener('abort',abort);session?.abort();}
}
