// Run inside the owned sessions container. This proves decoding, not ASR accuracy.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, unlinkSync} from 'node:fs';
import {request} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
assert.equal(process.env.SKILL_SANDBOX_SESSIONS_ONLY, '1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = '/tmp/audio-60min.mp3';
execFileSync('/usr/bin/ffmpeg', ['-nostdin','-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','3600','-c:a','libmp3lame','-b:a','16k','-y',fixture], {timeout:120000});
const bytes = readFileSync(fixture); unlinkSync(fixture);
assert.ok(bytes.length < 8388608);
async function call(method,path,body,token) {
 return new Promise((resolve,reject) => {
  const req=request({socketPath:process.env.SKILL_SANDBOX_SOCKET,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
const original={path:'/inputs/recording.mp3',contentBase64:bytes.toString('base64')};
const playlist=Buffer.from('#EXTM3U\n/inputs/recording.mp3\n');
const created=await call('POST','/sessions',{inputs:[original,{path:'/inputs/playlist.m3u',contentBase64:playlist.toString('base64')}]});assert.equal(created.status,201,JSON.stringify(created));
const {sessionId,token}=created.body,prefix=`/sessions/${sessionId}`;
const execute=command=>call('POST',`${prefix}/executions`,{executionId:randomUUID(),command,timeoutMs:120000},token);
try {
 const script=readFileSync(process.env.AUDIO_PROBE_SOURCE_SCRIPT || '/usr/local/lib/workspacex/decode-audio.py');
 assert.equal((await call('POST',`${prefix}/files`,{path:'/workspace/decode.py',contentBase64:script.toString('base64')},token)).status,200);
 const libraryPrefix = process.env.AUDIO_PROBE_LIBRARY_LAYOUT === '1' ? `LD_LIBRARY_PATH=/usr/lib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/blas:/usr/lib/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/lapack ` : '';
 const base=`${libraryPrefix}python3 /workspace/decode.py --source /inputs/recording.mp3 --source-hash ${sha(bytes)} --max-source-bytes 8388608 --chunk-duration-ms 30000 --max-chunks 120`;
 const start=Date.now(); const decoded=await execute(`${base} --max-duration-ms 3600000`);
 assert.equal(decoded.status,200);assert.equal(decoded.body.exitCode,0,JSON.stringify(decoded));assert.equal(decoded.body.truncated,false);
 const chunks=JSON.parse(decoded.body.output); assert.equal(chunks.length,120);
 let total=0;
 for(let index=0;index<chunks.length;index++) {
  const chunk=chunks[index];assert.equal(chunk.startMs,index*30000);assert.equal(chunk.endMs,(index+1)*30000);
  const read=await call('GET',`${prefix}/files?path=${encodeURIComponent(chunk.path)}`,undefined,token);assert.equal(read.status,200);
  const pcm=Buffer.from(read.body.contentBase64,'base64');assert.equal(pcm.length,960000);assert.equal(sha(pcm),chunk.sha256);total+=pcm.length;
 }
 assert.equal(total,115200000);
 assert.equal((await call('GET',`${prefix}/files?path=/inputs/recording.mp3`,undefined,token)).body.contentBase64,original.contentBase64);
 const denied=await execute('rm /inputs/recording.mp3');assert.notEqual(denied.body.exitCode,0);
 const over=await execute(`${base} --max-duration-ms 3599000`);assert.notEqual(over.body.exitCode,0,'must reject, not truncate, long sources');
 const changed=await execute(`${base.replace(sha(bytes),'0'.repeat(64))} --max-duration-ms 3600000`);assert.notEqual(changed.body.exitCode,0);
 const playlistResult=await execute(`${base.replace('/inputs/recording.mp3','/inputs/playlist.m3u').replace(sha(bytes),sha(playlist))} --max-duration-ms 3600000`);assert.notEqual(playlistResult.body.exitCode,0,'playlist demuxing must remain unavailable');
 console.log(JSON.stringify({playlistRejected:true,sourceBytes:bytes.length,durationMs:3600000,chunks:chunks.length,pcmBytes:total,elapsedMs:Date.now()-start,originalUnchanged:true,oversizedDurationRejected:true,changedSourceRejected:true}));
} finally {assert.equal((await call('DELETE',prefix,undefined,token)).status,200);}
