import { runScriptWithRetries } from "../../src/application/skill/run-script-with-retries";
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { HttpSkillSandbox } from '../../src/infrastructure/skill/http-skill-sandbox';
import { createNativeSessionTransport } from '../../src/infrastructure/agent-run/native-session-transport';
import { toOrgId } from '../../src/domain/org-id';

it('legacy transport sends a stable server-bound owner hash outside the script payload', async () => {
  const owner = { orgId: toOrgId('quota-org'), userId: 'quota-user' };
  let header: unknown; let raw = '';
  const server = createServer((req,res) => {
    header=req.headers['x-sandbox-owner']; req.setEncoding('utf8'); req.on('data',part => {raw+=part;});
    req.on('end',()=>res.end(JSON.stringify({exitCode:0,stdout:'',stderr:'',files:[{name:'ok.txt',contentBase64:'NDI=',sizeBytes:2}],timedOut:false,durationMs:1})));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address(); if(!address||typeof address==='string')throw new Error('address');
    const sandbox=new HttpSkillSandbox({baseUrl:`http://127.0.0.1:${address.port}`});
    await runScriptWithRetries({sandbox,owner,timeoutMs:1000,generateScript:async()=>"```run_script\nconsole.log(42)\n```"});
    expect(header).toBe(createHash('sha256').update(JSON.stringify([owner.orgId,owner.userId])).digest('hex'));
    expect(raw).not.toContain('quota-user'); expect(raw).not.toContain('owner');
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('native create binds the same private owner header while keeping token and model schemas unchanged', async () => {
  const root=await mkdtemp(join(tmpdir(),'quota-uds-')); const socket=join(root,'s'); const key='a'.repeat(64);
  let header:unknown;
  const server=createServer((req,res)=>{header=req.headers['x-sandbox-owner'];req.resume();res.end(JSON.stringify({sessionId:randomUUID(),token:'b'.repeat(64),expiresAt:Date.now()+10000}));});
  await new Promise<void>(resolve=>server.listen(socket,resolve));
  try {
    const transport=createNativeSessionTransport(socket);
    await transport.create([],[],key);
    expect(header).toBe(key);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

it('Chat cancellation reaches an outstanding sandbox request rather than waiting for execution to finish', async () => {
  const {maybeRunSkillScript}=await import('../../src/application/agent-run/run-skill-script');
  let cancelled=false; let arrived!:()=>void; const started=new Promise<void>(resolve=>{arrived=resolve;});
  let signals=0;
  const sandbox={run:async(input:{signal?:AbortSignal})=>{
    arrived();
    return new Promise<never>((_resolve,reject)=>input.signal?.addEventListener('abort',()=>{signals++;reject(new Error('transport aborted'));},{once:true}));
  }};
  const result=maybeRunSkillScript({sandbox,objects:{} as never,regenerate:async()=>{throw new Error('must not retry');},cancelAtCheckpoint:async()=>cancelled,log:()=>{}},
    {runId:'cancel-queued',pinnedSkillCount:1,reply:'```js\nconsole.log(42)\n```'});
  await started; cancelled=true;
  expect(await result).toMatchObject({kind:'cancelled'});
  expect(signals).toBe(1);
});

it('checkpoint failure aborts an outstanding request and preserves the original failure', async () => {
  const {withScriptCancellation}=await import('../../src/application/agent-run/with-script-cancellation');
  let arrived!:()=>void;const started=new Promise<void>(resolve=>{arrived=resolve;});let checks=0;
  const failure=new Error('lease verification failed');
  const pending=withScriptCancellation(async()=>{if(++checks>1)throw failure;},signal=>{
    arrived();return new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('transport aborted')),{once:true}));
  });
  await started;
  await expect(pending).rejects.toBe(failure);
  expect(checks).toBe(2);
});
