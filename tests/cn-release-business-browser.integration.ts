/** Actual Chromium + local TLS fixture. This is not real provider/production E2E. */
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {executeBusiness,type Execution,type LiveState} from '../scripts/cn-release-business-runner';
const require=createRequire(import.meta.url);
const pwRoot=process.env.CN_TEST_PLAYWRIGHT??path.resolve('node_modules/.pnpm/playwright@1.62.0/node_modules/playwright');
const {chromium}=require(pwRoot);
const browserPath=process.env.CN_TEST_CHROMIUM??path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const html=`<!doctype html><meta charset=utf-8>
<input data-testid=login-email><input data-testid=login-password type=password><button data-testid=login-submit onclick="localStorage.setItem('wsx.sessionToken','isolated-session');location.href='/chat'">Login</button>
<button data-testid=chat-task-workbench-capability-picker>Choose</button><button data-testid=chat-task-workbench-capability-card data-agent-id=fixture-agent>Agent</button>
<textarea data-testid=copilotkit-v2-input></textarea><button data-testid=copilotkit-v2-send data-send-state=ready>Send</button>
<button data-testid=chat-task-workbench-composer-mic data-voice-phase=idle>Mic</button><div data-testid=chat-task-workbench-composer-live-transcript></div>
<div data-testid=chat-ai-markdown></div><button data-testid=run-trace-toggle aria-expanded=true>Trace</button><div data-testid=run-trace-body><div data-testid=run-trace-entry><span data-testid=copilotkit-v2-tool-generic>Tool</span></div></div>
<div data-testid=chat-produced-file-inline-card hidden>fixture.pdf<a data-testid=chat-produced-file-inline-download href=/fixture.pdf>Download</a></div>
<script>
const q=x=>document.querySelector('[data-testid="'+x+'"]');
q('copilotkit-v2-send').onclick=async()=>{const text=q('copilotkit-v2-input').value;const r=await fetch('/api/copilotkit/agent/fixture-agent/run',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('wsx.sessionToken')},body:text});await r.text();q('chat-ai-markdown').textContent='fixture sentinel';if(text==='make PDF')q('chat-produced-file-inline-card').hidden=false;};
q('chat-task-workbench-composer-mic').onclick=async()=>{const b=q('chat-task-workbench-composer-mic');if(b.dataset.voicePhase==='listening'){b.dataset.voicePhase='done';return;}const stream=await navigator.mediaDevices.getUserMedia({audio:true});const r=await fetch('/fixture-asr',{method:'POST',body:'isolated audio activity'});const text=await r.text();q('chat-task-workbench-composer-live-transcript').textContent=text;q('copilotkit-v2-input').value=text;b.dataset.voicePhase='listening';stream.getTracks().forEach(t=>t.stop());};
</script>`;
for (const recovery of [false,true]) test('canonical six journeys execute with real Chromium and local TLS: '+(recovery?'baseline after expired original window':'candidate'), {timeout:90000},async()=>{
 assert.ok(fs.existsSync(browserPath),'actual browser required; no skip on missing installation');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cn-business-browser-'));let server:https.Server|undefined;
 const oldRead=fs.readFileSync;const planAudio='/etc/workspacex-cn/maintenance-activation/isolated/audio.wav';
 try{
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key.pem'),'-out',path.join(temp,'cert.pem'),'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
  const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(32000,40);const actualAudio=path.join(temp,'audio.wav');fs.writeFileSync(actualAudio,audio);
  let runCount=0,readCount=0,asrCount=0,pdfCount=0;const runs=new Set<string>();
  server=https.createServer({key:oldRead(path.join(temp,'key.pem')),cert:oldRead(path.join(temp,'cert.pem'))},(req,res)=>{
   const json=(v:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
   if(req.url==='/.well-known/workspacex-deployment'||req.url==='/api/healthz')return json({deploymentMarker:'fixture-marker',trustworthy:true});
   if(req.url==='/api/feedback/fixture-feedback/github-issue')return json({feedbackId:'fixture-feedback',number:1,state:'open'});
   if(req.url==='/api/copilotkit/agent/fixture-agent/run'&&req.method==='POST'){
    assert.equal(req.headers.authorization,'Bearer isolated-session');const id='run-'+(++runCount);runs.add(id);res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({type:'CUSTOM',name:'execution_event',value:{runId:id}})+'\ndata: {"type":"RUN_FINISHED"}\n');return;
   }
   if(req.url?.startsWith('/api/agent-runs/')){assert.equal(req.headers.authorization,'Bearer isolated-session');assert.ok(runs.has(req.url.split('/').at(-1)!));readCount++;return json({status:'succeeded',resultMessageId:'fixture-message',skillVersionIds:['fixture-skill']});}
   if(req.url==='/fixture-asr'){asrCount++;res.end('fixture spoken words');return;}
   if(req.url==='/fixture.pdf'){pdfCount++;res.setHeader('Content-Type','application/pdf');res.end('%PDF-1.7\nfixture bytes');return;}
   res.setHeader('Content-Type','text/html');res.end(html);
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address()as any;const origin='https://127.0.0.1:'+address.port+'/';
  // Only adapt the isolated host's audio path and TLS trust. No route interception,
  // mocked browser API, or supplied journey results are used.
  (fs as any).readFileSync=function(p:any,...args:any[]){return p===planAudio?audio:(oldRead as any).call(this,p,...args);};
  const realChromium={launch:async(opts:any)=>{const b=await chromium.launch({...opts,args:opts.args.map((arg:string)=>arg.startsWith('--use-file-for-fake-audio-capture=')?'--use-file-for-fake-audio-capture='+actualAudio:arg)});return new Proxy(b,{get(t,k){if(k==='newContext')return (o:any)=>t.newContext({...o,ignoreHTTPSErrors:true});const v=t[k];return typeof v==='function'?v.bind(t):v;}});}};
  const now=Date.now(),identity={sourceRevision:'a'.repeat(40),baselineRevision:'b'.repeat(40),controlRevision:'c'.repeat(40),publicationAttemptId:'fixture-publication',attemptId:'fixture-browser',requestedAt:new Date(now-(recovery?3600000:0)).toISOString(),deadlineAt:new Date(now+(recovery?-3510000:90000)).toISOString()};
  const r:Execution={mode:recovery?'rollback':'acceptance',...(recovery?{rollbackApproval:{baselineRevision:identity.baselineRevision,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+90000).toISOString(),approvalSha256:'6'.repeat(64)}}:{}),identity,releaseSha256:'4'.repeat(64),publicOrigin:origin,bindingSha256:'d'.repeat(64),switchReceiptSha256:'e'.repeat(64),holdGeneration:'7'.repeat(32),stableWindowSeconds:0,plan:{publicUrl:origin,email:'fixture@example.invalid',password:'fixture-only',agentId:'fixture-agent',threadId:'fixture-thread',feedbackId:'fixture-feedback',githubIssueNumber:1,skillVersionId:'fixture-skill',skillSentinel:'sentinel',skillPrompt:'use skill',pdfPrompt:'make PDF',audioPath:planAudio,audioSha256:hash(audio),expectedTranscript:'fixture spoken words',browserExecutable:browserPath,playwrightModule:'/opt/workspacex-cn/release-tools/fixture',deploymentMarker:'fixture-marker'}};
  let tokenSeen=false;
  const result=await executeBusiness(r,{chromium:realChromium,captureSession:async t=>{assert.equal(t,'isolated-session');tokenSeen=true;},readLiveState:async()=>({identity,boundary:{phase:'isolated-candidate',lockRetained:true,writesHeld:true,testDataScopeApproved:true,publicResumeAuthorized:false},runtimeRevision:recovery?identity.baselineRevision:identity.sourceRevision,runtimeInventorySha256:'9'.repeat(64),deploymentMarker:'fixture-marker',bindingSha256:r.bindingSha256,switchReceiptSha256:r.switchReceiptSha256,holdGeneration:r.holdGeneration,observedAt:new Date().toISOString(),clearReceiptSha256:null,runtimeHealthy:true,writerResumeApprovalSha256:null,testDataScopeSha256:'3'.repeat(64)})});
  assert.equal(result.kind,'cn-isolated-business-acceptance-v1');assert.equal(result.runtimeRevision,recovery?identity.baselineRevision:identity.sourceRevision);assert.equal(result.requestedAt,identity.requestedAt);assert.equal(tokenSeen,true);assert.equal(runCount,3);assert.equal(readCount,6);assert.equal(asrCount,1);assert.equal(pdfCount,1);assert.deepEqual(result.ownedAcceptanceRunIds,['run-1','run-2','run-3']);assert.equal(result.externalWritesTerminal,false);
 }finally{(fs as any).readFileSync=oldRead;if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));fs.rmSync(temp,{recursive:true,force:true});}
});
