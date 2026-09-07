import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {recording} from '@repo/contracts';
import {AUDIO_TRANSCRIBE_LIMITS as L} from '@repo/contracts/standard-audio-tools';
import {schemas} from '@repo/contracts/sandbox-session';
import type {ImageSession} from '../../application/agent-run/standard-image-tools';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const Chunk=z.object({path:z.string(),startMs:z.number().int().nonnegative(),endMs:z.number().int().positive(),sizeBytes:z.number().int().positive(),frames:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Python's existing wave decoder; no handwritten media/container parser. */
export async function decodeWav(session:ImageSession,path:string,sourceHash:string){
 const prefix=`/workspace/audio-${sourceHash}`;
 const format=recording.ASR_AUDIO_FORMAT;
 const code=`import wave,io,hashlib,json\nfrom pathlib import Path\ndata=Path(${JSON.stringify(path)}).read_bytes()\nassert len(data)<=${L.maxBytes}\nassert hashlib.sha256(data).hexdigest()==${JSON.stringify(sourceHash)}\nw=wave.open(io.BytesIO(data),'rb')\nassert w.getnchannels()==${format.channels} and w.getsampwidth()==2 and w.getframerate()==${format.sampleRate} and w.getcomptype()=='NONE'\nn=w.getnframes()\nassert 0<n<=${L.maxDurationMs*format.sampleRate/1000}\nchunks=[]\nstep=${L.chunkDurationMs*format.sampleRate/1000}\nfor start in range(0,n,step):\n raw=w.readframes(min(step,n-start))\n assert len(raw)==min(step,n-start)*2\n p=${JSON.stringify(prefix)}+'-'+str(start)+'.pcm'\n Path(p).write_bytes(raw)\n chunks.append(dict(path=p,startMs=start*1000//${format.sampleRate},endMs=((start+len(raw)//2)*1000+${format.sampleRate-1})//${format.sampleRate},sizeBytes=len(raw),frames=len(raw)//2,sha256=hashlib.sha256(raw).hexdigest()))\nprint(json.dumps(chunks))`;
 const execution={executionId:randomUUID(),command:`python3 -c ${quote(code)}`,timeoutMs:30000};
 const result=await session.execute(execution);
 if(result.executionId!==execution.executionId||result.exitCode!==0||result.cancelled||result.timedOut||result.truncated)throw new Error('audio_decode_failed');
 const chunks=z.array(Chunk).min(1).max(L.maxDurationMs/L.chunkDurationMs).parse(JSON.parse(result.output));
 let end=0;
 for(const chunk of chunks){
  if(chunk.startMs!==end||chunk.endMs<=end||chunk.endMs>L.maxDurationMs||chunk.endMs-chunk.startMs>L.chunkDurationMs||chunk.path!==`${prefix}-${chunk.startMs*format.sampleRate/1000}.pcm`||chunk.sizeBytes!==chunk.frames*2||chunk.endMs!==Math.ceil(chunk.startMs+chunk.frames*1000/format.sampleRate))throw new Error('audio_chunk_invalid');end=chunk.endMs;
 }
 return {chunks,read:async(chunk:z.infer<typeof Chunk>)=>{const file=schemas.file.parse(await session.read(chunk.path));const bytes=Buffer.from(file.contentBase64,'base64');if(file.path!==chunk.path||file.sizeBytes!==chunk.sizeBytes||bytes.length!==chunk.sizeBytes||hash(bytes)!==chunk.sha256)throw new Error('audio_chunk_changed');return bytes;}};
}
