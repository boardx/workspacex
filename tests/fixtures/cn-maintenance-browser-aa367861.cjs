'use strict';
// Real 9b UI actions; no interception, loopback model, or supplied passed flags.
const fs=require('node:fs'),crypto=require('node:crypto');
const check=(ok,code)=>{if(!ok)throw Error(code)};
function validatePlan(p){
 const keys=['publicUrl','email','password','agentId','threadId','feedbackId','githubIssueNumber','skillVersionId','skillSentinel','skillPrompt','pdfPrompt','audioPath','audioSha256','expectedTranscript','browserExecutable','deploymentMarker','playwrightModule'];
 check(p&&Object.keys(p).sort().join('|')===keys.sort().join('|'),'BROWSER_PLAN_SCHEMA');
 for(const key of keys.filter(k=>k!=='githubIssueNumber'))check(typeof p[key]==='string'&&p[key].length>0&&!p[key].includes('\0'),'BROWSER_PLAN_INPUT');
 const url=new URL(p.publicUrl);check(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','BROWSER_ORIGIN');
 for(const key of ['agentId','threadId','feedbackId','skillVersionId'])check(/^[a-zA-Z0-9_-]{1,128}$/.test(p[key]),'BROWSER_ID');
 check(Number.isSafeInteger(p.githubIssueNumber)&&p.githubIssueNumber>0&&/^[a-f0-9]{64}$/.test(p.audioSha256),'BROWSER_FIXTURE');
 check(p.audioPath.startsWith('/etc/workspacex-cn/maintenance-activation/')&&!p.audioPath.split('/').includes('..')&&p.browserExecutable.startsWith('/')&&!p.browserExecutable.split('/').includes('..')&&p.playwrightModule.startsWith('/opt/workspacex-cn/release-tools/')&&!p.playwrightModule.split('/').includes('..'),'BROWSER_RUNTIME_SCOPE');
 check(!p.skillSentinel.includes('loopback')&&!p.expectedTranscript.includes('loopback'),'REAL_PROVIDER_REQUIRED');return p;
}
function finishedRun(text){
 check(typeof text==='string'&&Buffer.byteLength(text)<=16*1024*1024,'RUN_STREAM_BOUND');
 const events=text.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
 check(events.length>0&&!events.some(e=>e.type==='RUN_ERROR')&&events.at(-1).type==='RUN_FINISHED','REAL_RUN_FINISHED_REQUIRED');
 const runId=events.find(e=>e.type==='CUSTOM'&&e.name==='execution_event')?.value?.runId;
 check(typeof runId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(runId),'RUN_ID_REQUIRED');return runId;
}
async function run(raw,chromium){
 const p=validatePlan(raw),audio=fs.readFileSync(p.audioPath);check(audio.length>44&&audio.length<16*1024*1024&&audio.subarray(0,4).toString()==='RIFF'&&crypto.createHash('sha256').update(audio).digest('hex')===p.audioSha256,'ACTUAL_AUDIO_FIXTURE');
 const browser=await chromium.launch({headless:true,executablePath:p.browserExecutable,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${p.audioPath}`]});
 const context=await browser.newContext({permissions:['microphone']}),page=await context.newPage();page.setDefaultTimeout(30000);
 const ownedRuns=[];
 async function authRead(path){return page.evaluate(async path=>{const token=localStorage.getItem('wsx.sessionToken');if(!token)throw Error('SESSION_REQUIRED');const r=await fetch(path,{headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store'});if(!r.ok)throw Error('AUTH_READ_FAILED');return r.json();},path);}
 async function submit(prompt){
  await page.getByTestId('copilotkit-v2-input').fill(prompt);
  await page.waitForFunction(()=>document.querySelector('[data-testid="copilotkit-v2-send"]')?.getAttribute('data-send-state')==='ready');
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(r.url()),{timeout:300000});
  await page.getByTestId('copilotkit-v2-send').click();const response=await responsePromise;check(response.status()===200,'RUN_HTTP');
  const runId=finishedRun(await response.text());ownedRuns.push(runId);const result=await authRead('/api/agent-runs/'+runId);check(result.status==='succeeded'&&typeof result.resultMessageId==='string','PERSISTED_RUN_FINISHED');
  return result;
 }
 try{
  await page.goto(new URL('/login',p.publicUrl).href,{waitUntil:'domcontentloaded'});
  await page.getByTestId('login-email').fill(p.email);await page.getByTestId('login-password').fill(p.password);await page.getByTestId('login-submit').click();
  await page.waitForURL(u=>u.origin===new URL(p.publicUrl).origin&&u.pathname!=='/login');
  const markers=await page.evaluate(async()=>{const [a,b]=await Promise.all([fetch('/.well-known/workspacex-deployment',{cache:'no-store'}),fetch('/api/healthz',{cache:'no-store'})]);if(!a.ok||!b.ok)throw Error('DEPLOYMENT_HTTP');return [await a.json(),await b.json()];});
  check(markers[0].deploymentMarker===p.deploymentMarker&&markers[1].deploymentMarker===p.deploymentMarker&&markers[1].trustworthy===true,'PUBLIC_DEPLOYMENT_IDENTITY');
  const feedback=await authRead('/api/feedback/'+p.feedbackId+'/github-issue');check(feedback.feedbackId===p.feedbackId&&feedback.number===p.githubIssueNumber&&['open','closed'].includes(feedback.state),'REAL_GITHUB_FEEDBACK_READ');
  await page.goto(new URL('/chat?thread='+encodeURIComponent(p.threadId),p.publicUrl).href);
  await page.getByTestId('chat-task-workbench-capability-picker').click();await page.locator(`[data-testid="chat-task-workbench-capability-card"][data-agent-id="${p.agentId}"]`).click();
  await submit('hello');check((await page.getByTestId('chat-ai-markdown').last().innerText()).trim().length>0,'HELLO_RESPONSE');
  const mic=page.getByTestId('chat-task-workbench-composer-mic');await mic.click();await page.waitForFunction(()=>document.querySelector('[data-testid="chat-task-workbench-composer-mic"]')?.getAttribute('data-voice-phase')==='listening');
  await page.waitForFunction(text=>document.querySelector('[data-testid="chat-task-workbench-composer-live-transcript"]')?.textContent?.includes(text),p.expectedTranscript,{timeout:60000});
  await mic.click();await page.waitForFunction(()=>document.querySelector('[data-testid="chat-task-workbench-composer-mic"]')?.getAttribute('data-voice-phase')==='done');
  check((await page.getByTestId('copilotkit-v2-input').inputValue()).includes(p.expectedTranscript),'ACTUAL_ASR_TRANSCRIPT');
  const skill=await submit(p.skillPrompt);check(Array.isArray(skill.skillVersionIds)&&skill.skillVersionIds.includes(p.skillVersionId),'PERSISTED_SKILL_SNAPSHOT');check((await page.getByTestId('chat-ai-markdown').last().innerText()).includes(p.skillSentinel),'ACTUAL_SKILL_SENTINEL');
  const toggle=page.getByTestId('run-trace-toggle').last();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.getByTestId('run-trace-body').last().getByTestId('run-trace-entry').filter({has:page.getByTestId('copilotkit-v2-tool-generic')}).first().waitFor({state:'visible'});
  await submit(p.pdfPrompt);const card=page.getByTestId('chat-produced-file-inline-card').filter({hasText:/\.pdf/i}).last();await card.waitFor({state:'visible'});check(await card.getByTestId('chat-produced-file-inline-failed').count()===0,'PDF_CARD_FAILED');
  const download=card.getByTestId('chat-produced-file-inline-download');await download.waitFor({state:'visible'});const href=await download.getAttribute('href');check(href&&await download.getAttribute('aria-disabled')!=='true','PDF_DOWNLOAD_LINK');
  const magic=await page.evaluate(async href=>{const r=await fetch(href);if(!r.ok)throw Error('PDF_HTTP');const b=new Uint8Array(await r.arrayBuffer());if(b.length<5||b.length>16*1024*1024)throw Error('PDF_BYTES');return String.fromCharCode(...b.subarray(0,5));},href);check(magic==='%PDF-','PDF_MAGIC');
  for(const runId of ownedRuns)check((await authRead('/api/agent-runs/'+runId)).status==='succeeded','OWNED_RUN_NOT_TERMINAL');
  return {login:true,hello:true,asr:true,githubFeedbackRead:true,skillTool:true,pdfDownload:true};
 }finally{await context.close();await browser.close();}
}
module.exports={validatePlan,finishedRun,run};
