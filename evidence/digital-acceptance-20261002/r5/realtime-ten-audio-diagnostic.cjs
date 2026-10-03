/** Supplemental real vendor audio diagnostic; NOT physical microphone/browser acceptance. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const WebSocket = require(require('node:module').createRequire(require('node:path').resolve('apps/api/package.json')).resolve('ws'));
const env = parseEnv(fs.readFileSync(process.env.QWEN_ACCEPTANCE_ENV_FILE, 'utf8'));
const fixture = fs.readFileSync(process.env.QWEN_ACCEPTANCE_PCM_FILE);
if (!fixture.length || fixture.length % 2) throw new Error('Nonempty s16le input required');
const url = new URL(env.KERNEL_MODEL_BASE_URL); url.protocol = 'wss:'; url.pathname = '/api-ws/v1/realtime'; url.search = '?model=qwen3.8-omni-flash-realtime';
const report = {at:new Date().toISOString(), model:'qwen3.8-omni-flash-realtime', inputFixtureBytes:fixture.length, inputFixtureSha256:crypto.createHash('sha256').update(fixture).digest('hex'),
 boundary:'Supplemental continuous vendor audio I/O with the same vendor-generated speech fixture, not ten natural human conversational rounds. Commit-to-first-received-PCM is network/model latency, not pause-to-first-played-sound. No browser playback, microphone, interruption stop, mute, hangup persistence or device-release acceptance is claimed.', rounds:[], finished:false};
let ws, current, watchdog, stopped=false;
const output = process.env.QWEN_ACCEPTANCE_REPORT_FILE;
function save(reason) { report.reason=reason; fs.writeFileSync(output,JSON.stringify(report,null,2)); }
function stop(reason) {
 if(stopped)return;stopped=true;clearTimeout(watchdog);
 const allAudio=report.rounds.length===10&&report.rounds.every(r=>r.outputAudioBytes>0&&r.status==='completed');
 process.exitCode=reason==='ten_vendor_audio_exchanges'&&allAudio?0:1;
 save(reason);ws?.close();console.log(JSON.stringify({reason,rounds:report.rounds.length,allAudio,p95CommitToFirstReceivedPcmMs:report.p95CommitToFirstReceivedPcmMs,boundary:report.boundary}));
}
function send(value) {ws.send(JSON.stringify(value));}
function next() {
 const ordinal=report.rounds.length+1;
 current={ordinal,inputAudioBytes:fixture.length,outputAudioBytes:0,events:[],started:performance.now(),audioHash:crypto.createHash('sha256'),transcript:''};
 clearTimeout(watchdog);watchdog=setTimeout(()=>stop('round_timeout'),30000);
 send({type:'input_audio_buffer.append',audio:fixture.toString('base64')});
 current.commitAt=performance.now();send({type:'input_audio_buffer.commit'});
}
ws = new WebSocket(url,{headers:{Authorization:`Bearer ${env.KERNEL_MODEL_API_KEY}`,'OpenAI-Beta':'realtime=v1'}});
watchdog=setTimeout(()=>stop('connect_timeout'),30000);
ws.on('open',()=>send({type:'session.update',session:{modalities:['text','audio'],instructions:'你是语音链路诊断助手。每次听到验证语句，用中文简短回应一句并说明这是一次音频交谈。',turn_detection:null,input_audio_transcription:{model:'gummy-realtime-v1'},audio:{input:{format:{type:'pcm',sample_rate:16000,sample_format:'s16le',channels:1,packing:'interleaved',channel_layout:'mono'}},output:{voice:'Maia',format:{type:'pcm',sample_rate:24000}}}}}));
ws.on('message',raw=>{
 let event;try{event=JSON.parse(raw.toString());}catch{return;}
 if(event.type==='error'){report.errorCode=String(event.error?.code||event.error?.type||'unknown');stop('provider_error');return;}
 if(event.type==='session.updated'){next();return;}
 if(!current)return;
 if(!current.events.includes(event.type))current.events.push(event.type);
 if(event.type==='input_audio_buffer.committed')send({type:'response.create'});
 if(['response.audio.delta','response.output_audio.delta'].includes(event.type)&&event.delta){
  const bytes=Buffer.from(event.delta,'base64');if(bytes.length){current.firstAudioAt??=performance.now();current.audioHash.update(bytes);current.outputAudioBytes+=bytes.length;}
 }
 if(['response.audio_transcript.delta','response.output_audio_transcript.delta'].includes(event.type))current.transcript+=event.delta||'';
 if(event.type==='response.done'){
  const result={ordinal:current.ordinal,inputAudioBytes:current.inputAudioBytes,outputAudioBytes:current.outputAudioBytes,outputAudioSha256:current.audioHash.digest('hex'),transcript:current.transcript,commitToFirstReceivedPcmMs:current.firstAudioAt?Math.round(current.firstAudioAt-current.commitAt):null,elapsedMs:Math.round(performance.now()-current.started),status:event.response?.status??'unknown',events:current.events};
  report.rounds.push(result);save('in_progress');current=null;
  if(!result.outputAudioBytes||result.status==='failed'){stop('audio_or_response_failure');return;}
  if(report.rounds.length===10){report.finished=true;const values=report.rounds.map(r=>r.commitToFirstReceivedPcmMs).sort((a,b)=>a-b);report.p95CommitToFirstReceivedPcmMs=values[Math.ceil(values.length*0.95)-1];stop('ten_vendor_audio_exchanges');}else next();
 }
});
ws.on('unexpected-response',(_req,response)=>stop(`http_${response.statusCode}`));
ws.on('error',()=>stop('connection_error'));
ws.on('close',()=>{clearTimeout(watchdog);if(!report.finished&&report.reason==='in_progress')save('unexpected_close');});
