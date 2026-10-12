/** Full application fixture. No browser route interception or supplied acceptance booleans. */
import {test,expect,type Page} from '@playwright/test';
const {finishedRun}=require('../../../.harness/scripts/vm/cn-maintenance-browser.cjs');
import {CHAT_READ_E2E as F} from './chat-read-fixture';
import {openFreshThread} from './chat-task-workbench-fixture';
import {selectWorkbenchAgent} from './support/workbench-run-evidence';
// These existing assertions exercise actual microphone/WS and persisted PDF run/download.
import './copilotkit-v2-voice-input.spec';
import './agent-task-clarification-result.spec';
test.setTimeout(180000);
async function login(page:Page){await page.goto('/login');await page.getByTestId('login-email').fill(F.email);await page.getByTestId('login-password').fill(F.password);await page.getByTestId('login-submit').click();await page.waitForURL(/\/home$/);}
async function submitAndReadback(page:Page,prompt:string){
 await page.getByTestId('copilotkit-v2-input').fill(prompt);
 const pending=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/copilotkit\/agent\/[^/]+\/run$/.test(new URL(r.url()).pathname),{timeout:90000});
 await page.getByTestId('copilotkit-v2-send').click();const response=await pending;expect(response.ok()).toBe(true);const runId=finishedRun(await response.text());
 const read=()=>page.evaluate(async id=>{const token=localStorage.getItem('wsx.sessionToken');if(!token)throw Error('SESSION_REQUIRED');const r=await fetch('/api/agent-runs/'+id,{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw Error('RUN_READ_FAILED');return r.json();},runId);
 await expect.poll(async()=>(await read()).status,{timeout:90000}).toBe('succeeded');
 await page.reload();const persisted=await read();expect(persisted.status).toBe('succeeded');expect(persisted.resultMessageId).toBeTruthy();return runId;
}
test('CN six: actual application login creates a session',async({page})=>{
 await login(page);expect(await page.evaluate(()=>Boolean(localStorage.getItem('wsx.sessionToken')))).toBe(true);
 await page.reload();await expect(page).toHaveURL(/\/home$/);
});
test('CN six: hello runs through application and loopback model',async({page})=>{
 await openFreshThread(page);await selectWorkbenchAgent(page,F.agentId);
 const prompt='CN isolated hello';await submitAndReadback(page,prompt);
 await expect(page.getByTestId('chat-ai-markdown').last()).toContainText(F.agentReplyPrefix,{timeout:90000});
 await expect(page.getByTestId('chat-ai-markdown').last()).toContainText(prompt);
});
test('CN six: actual skill content reaches provider through runtime',async({page})=>{
 await openFreshThread(page);await selectWorkbenchAgent(page,F.deepAgentId);
 const runId=await submitAndReadback(page,'CN isolated skill proof');
 const journal=await page.evaluate(async id=>{const token=localStorage.getItem('wsx.sessionToken');if(!token)throw Error('SESSION_REQUIRED');const r=await fetch('/api/agent-runs/'+id+'/execution-events?afterSeq=-1',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw Error('JOURNAL_READ_FAILED');return r.json();},runId);
 const started=journal.events.filter((e:any)=>e.kind==='tool_start'&&e.toolName==='lookup_time');expect(started.length).toBeGreaterThan(0);
 for(const start of started){const ends=journal.events.filter((e:any)=>e.kind==='tool_end'&&e.toolCallId===start.toolCallId);expect(ends).toHaveLength(1);expect(ends[0].ok).toBe(true);expect(ends[0].result).toBeTruthy();}
 await expect(page.getByTestId('chat-ai-markdown').last()).toContainText(F.mountedSkillEchoPrefix+F.mountedSkillSentinel,{timeout:90000});
 const toggle=page.getByTestId('run-trace-toggle').last();await expect(toggle).toBeVisible();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await expect(page.getByTestId('run-trace-entry').filter({has:page.getByTestId('copilotkit-v2-tool-generic')}).first()).toBeVisible();
});
test('CN six: real authenticated feedback route reads loopback GitHub protocol',async({page})=>{
 await login(page);
 const value=await page.evaluate(async()=>{
  const token=localStorage.getItem('wsx.sessionToken');if(!token)throw Error('SESSION_REQUIRED');
  const r=await fetch('/api/feedback/cn-six-feedback/github-issue',{headers:{Authorization:'Bearer '+token}});
  return {status:r.status,body:await r.json()};
 });
 expect(value.status).toBe(200);expect(value.body).toMatchObject({feedbackId:'cn-six-feedback',number:1,state:'open',linkedPullRequestsAvailable:true});
});
