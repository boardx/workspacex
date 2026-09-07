import {randomUUID,createHash} from 'node:crypto';
import type {z} from 'zod';
import {recording} from '@repo/contracts';
import {AUDIO_TRANSCRIBE_LIMITS as L,AudioDecodedChunk,AudioDecodedChunks} from '@repo/contracts/standard-audio-tools';
import {schemas} from '@repo/contracts/sandbox-session';
import type {ImageSession} from '../../application/agent-run/standard-image-tools';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";

/** Uses the installed, independently verified offline FFmpeg adapter. */
export async function decodeWav(session:ImageSession,path:string,sourceHash:string){
 if(!path.startsWith('/inputs/')||path.split('/').includes('..')||! /^[a-f0-9]{64}$/.test(sourceHash))throw new Error('audio_source_invalid');
 const prefix=`/workspace/audio-${sourceHash}`;
 const format=recording.ASR_AUDIO_FORMAT;
 const command=`python3 /usr/local/lib/workspacex/decode-audio.py --source ${quote(path)} --source-hash ${sourceHash} --max-source-bytes ${L.maxBytes} --max-duration-ms ${L.maxDurationMs} --chunk-duration-ms ${L.chunkDurationMs} --max-chunks ${L.maxDurationMs/L.chunkDurationMs}`;
 const execution={executionId:randomUUID(),command,timeoutMs:L.decodeDeadlineMs};
 const result=await session.execute(execution);
 if(result.executionId!==execution.executionId||result.exitCode!==0||result.cancelled||result.timedOut||result.truncated)throw new Error('audio_decode_failed');
 const chunks=AudioDecodedChunks.parse(JSON.parse(result.output));
 let end=0;
 for(const chunk of chunks){
  if(chunk.startMs!==end||chunk.endMs<=end||chunk.endMs>L.maxDurationMs||chunk.endMs-chunk.startMs>L.chunkDurationMs||chunk.path!==`${prefix}-${chunk.startMs*format.sampleRate/1000}.pcm`||chunk.sizeBytes!==chunk.frames*2||chunk.endMs!==Math.ceil(chunk.startMs+chunk.frames*1000/format.sampleRate))throw new Error('audio_chunk_invalid');end=chunk.endMs;
 }
 return {chunks,read:async(chunk:z.infer<typeof AudioDecodedChunk>)=>{const file=schemas.file.parse(await session.read(chunk.path));const bytes=Buffer.from(file.contentBase64,'base64');if(file.path!==chunk.path||file.sizeBytes!==chunk.sizeBytes||bytes.length!==chunk.sizeBytes||hash(bytes)!==chunk.sha256)throw new Error('audio_chunk_changed');return bytes;}};
}
