import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSandboxServer } from '../src/server.js';
import { ExecutionCapacity } from '../src/execution-capacity.js';
const servers: ReturnType<typeof createSandboxServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
function latch() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
async function setup() {
  const capacity = new ExecutionCapacity({ concurrency: 1, maxQueue: 1, ownerConcurrency: 1, ownerMaxQueue: 1, queueWaitMs: 1000 });
  const server = createSandboxServer({ capacity }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  function call(path: string, data?: unknown, owner = 'a'.repeat(64)) {
    let req!: ReturnType<typeof request>;
    const result = new Promise<{status: number; body: any; retry?: string}>(resolve => {
      req = request({ host: '127.0.0.1', port, path, method: data ? 'POST' : 'GET', headers: {'content-type':'application/json','x-sandbox-owner':owner} }, res => {
        let raw = ''; res.setEncoding('utf8'); res.on('data', part => { raw += part; });
        res.on('end', () => resolve({status: res.statusCode!, body: JSON.parse(raw), retry: res.headers['retry-after']}));
      });
      req.on('error', () => resolve({status: 0, body: null})); req.end(data ? JSON.stringify(data) : undefined);
    });
    return { req, result };
  }
  return { capacity, call };
}
const script = { script: "require('node:fs').writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR+'/ok.txt','done')", timeoutMs: 1000 };
async function queued(capacity: ExecutionCapacity) {
  for (let i = 0; i < 100; i++) { if (capacity.snapshot().queued === 1) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('request did not queue');
}

describe('legacy HTTP execution admission', () => {
  it('exposes aggregate capacity and rejects overflow while the accepted script eventually returns its real file', async () => {
    const { capacity, call } = await setup(); const gate = latch();
    const running = capacity.run('blocker', () => gate.promise);
    try {
      const metrics = await call('/capacity').result;
      expect(metrics.status).toBe(200); expect(metrics.body).toMatchObject({active:1,queued:0});
      const waiting = call('/run', script); await queued(capacity);
      const full = await call('/run', script, 'b'.repeat(64)).result;
      expect(full).toMatchObject({status:429,body:{error:'CAPACITY_QUEUE_FULL'},retry:'1'});
      gate.release(); await running;
      const result = await waiting.result;
      expect(result.status).toBe(200); expect(result.body.exitCode).toBe(0);
      expect(result.body.files).toContainEqual(expect.objectContaining({name:'ok.txt',contentBase64:'ZG9uZQ=='}));
      expect(capacity.snapshot()).toMatchObject({active:0,queued:0});
    } finally { gate.release(); await running; }
  });

  it('removes a disconnected waiting request and allows the next user in', async () => {
    const { capacity, call } = await setup(); const gate = latch(); const running = capacity.run('blocker', () => gate.promise);
    try {
      const waiting = call('/run', script); await queued(capacity); waiting.req.destroy(); await waiting.result;
      for (let i=0; i<100 && capacity.snapshot().queued; i++) await new Promise(r => setTimeout(r,5));
      expect(capacity.snapshot()).toMatchObject({active:1,queued:0,cancelled:1});
      gate.release(); await running;
      expect((await call('/run',script,'b'.repeat(64)).result).status).toBe(200);
    } finally { gate.release(); await running; }
  });

  it('rejects a malformed owner before executing', async () => {
    const {capacity,call}=await setup();
    expect((await call('/run',script,'chosen-by-model').result).status).toBe(400);
    expect(capacity.snapshot().completed).toBe(0);
  });
});

it('keeps the slot occupied until a running legacy child has been killed and cleaned', async () => {
  const {executeScript}=await import('../src/execute-script.js');
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'sandbox-abort-')),pidFile=join(root,'pid'),binary=join(root,'node');
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  await writeFile(binary,`#!/bin/sh\nprintf '%s' "$$" > ${quote(pidFile)}\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o700});
  const capacity=new ExecutionCapacity({concurrency:1,maxQueue:1,ownerConcurrency:1,ownerMaxQueue:1,queueWaitMs:1000});
  const abort=new AbortController();
  const running=capacity.run('a',signal=>executeScript({script:'while(true){}',timeoutMs:5000,nodeBinary:binary,signal}),{signal:abort.signal});
  const stopped=expect(running).rejects.toThrow();
  try{
    let pid=0;
    for(let i=0;i<100&&!pid;i++){try{pid=Number(await readFile(pidFile,'utf8'));}catch{}if(!pid)await new Promise(r=>setTimeout(r,5));}
    expect(pid).toBeGreaterThan(0);
    expect(capacity.snapshot().active).toBe(1);
    const next=capacity.run('b',async()=>{expect(()=>process.kill(pid,0)).toThrow();return 'next';});
    abort.abort();await stopped;expect(await next).toBe('next');
    expect(capacity.snapshot()).toMatchObject({active:0,queued:0});
  }finally{abort.abort();await running.catch(()=>{});await rm(root,{recursive:true,force:true});}
});
