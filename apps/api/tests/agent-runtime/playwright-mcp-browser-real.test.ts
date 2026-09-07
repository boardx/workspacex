import { createServer, request as httpRequest, type Server } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { STANDARD_BROWSER_LIMITS as L } from '@repo/contracts/standard-browser-tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { schemas } from '@repo/contracts/sandbox-session';
import { createNativeSessionTransport } from '../../src/infrastructure/agent-run/native-session-transport';
import { createNativeDraftSession } from '../../src/infrastructure/agent-run/native-draft-session';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NativeSessionOwner, NativeResolved } from '../../src/application/agent-run/native-session-owner';
import type { ToolExecutionAuthority } from '../../src/application/agent-run/tool-execution-authority';
import type { BrowserExecutionReceipts } from '../../src/application/agent-run/standard-browser-tools';
import {
  OfficialPlaywrightMcpSessionFactory,
  RemotePlaywrightMcpSessionFactory,
  PlaywrightMcpBrowserAdapter,
  type BrowserNetworkPolicy,
  type BrowserMcpSessionFactory,
} from '../../src/infrastructure/agent-run/playwright-mcp-browser-adapter';

// Optional diagnostics contain only this test's local HTML fixture responses.
function observedFactory(network: BrowserNetworkPolicy): BrowserMcpSessionFactory {
  const official = process.env.WX_BROWSER_REMOTE_ENDPOINT
    ? new RemotePlaywrightMcpSessionFactory(process.env.WX_BROWSER_REMOTE_ENDPOINT)
    : new OfficialPlaywrightMcpSessionFactory(network, { allowInProcessBrowserWithoutNetworkNamespace: true });
  return { async create(key) {
    const session = await official.create(key);
    return { outputDir: session.outputDir, close: () => session.close(), async call(name, args, signal) {
      const result = await session.call(name, args, signal);
      if (process.env.WX_BROWSER_FIXTURE_DIAGNOSTICS === '1' && (result.isError || name === 'browser_take_screenshot')) console.error('fixture MCP result', name, JSON.stringify(result));
      return result;
    } };
  } };
}

const enabled = process.env.WORKSPACEX_REAL_BROWSER === '1';
const suite = enabled ? describe : describe.skip;
const A = '00000000-0000-4000-8000-000000000011';
const B = '00000000-0000-4000-8000-000000000012';

suite('W10 real Playwright MCP and Chromium acceptance', () => {
  let server: Server;
  let url: string;
  let externalRequests = 0;
  const adapters: PlaywrightMcpBrowserAdapter[] = [];

  beforeAll(async () => {
    server = createServer((_request, response) => {
      if (_request.url?.startsWith('/csp-leak')) externalRequests++;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><title>W10 fixture</title><meta name="viewport" content="width=device-width"><main><label>Name <input aria-label="Name"></label><label><input type="checkbox" aria-label="Subscribe"> Subscribe</label><button id="save">Save</button><output id="count">Saved 0</output><script>const out=document.querySelector('#count');out.textContent='Saved '+(localStorage.count||0);document.querySelector('#save').onclick=()=>{const next=Number(localStorage.count||0)+1;localStorage.count=String(next);document.cookie='saved='+next+'; SameSite=Lax';out.textContent='Saved '+next}</script></main>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture unavailable');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await Promise.all(adapters.flatMap(adapter => [adapter.release(A), adapter.release(B)]));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('navigates, snapshots, fills, clicks, isolates storage, and writes a real PNG', async () => {
    const allowFixture: BrowserNetworkPolicy = { async assertAllowed(candidate) { if (!candidate.startsWith(url)) throw new Error('blocked'); } };
    const files = new Map<string, string>();
    const resolved = { sessionId: 'real-session', expiresAt: Date.now() + 60_000 } as unknown as NativeResolved;
    const owner = { resolve: async () => resolved } as unknown as NativeSessionOwner;
    const authority = { check: async () => ({ allowed: true, reason: 'allowed' }) } as unknown as Pick<ToolExecutionAuthority, 'check'>;
    const receipts: BrowserExecutionReceipts = {
      async claim() { return { kind: 'claimed' }; },
      async succeed() {},
      async markUnconfirmed() {},
    };
    const workspace = {
      async write(file: { path: string; contentBase64: string }) { files.set(file.path, file.contentBase64); return {}; },
      async read(path: string) { const contentBase64 = files.get(path); if (!contentBase64) throw new Error('missing'); return { path, contentBase64, sizeBytes: Buffer.from(contentBase64, 'base64').length }; },
    };
    const adapter = new PlaywrightMcpBrowserAdapter(owner, () => workspace, authority, receipts, allowFixture, observedFactory(allowFixture));
    adapters.push(adapter);
    const context = (bindingId: string, run: string) => ({ orgId: 'org' as never, parentRunId: run, attemptId: `${run}:0`, leaseEpoch: 1, bindingId, toolCallId: `${run}-${randomUUID()}` });
    const openA = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url } });
    const pageA = 'pageRef' in openA ? openA.pageRef : '';
    const snapA = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_snapshot', toolArgs: { pageRef: pageA } });
    if (!('snapshot' in snapA)) throw new Error('snapshot unavailable');
    const find = (label: string) => snapA.snapshot.split('\n').find(line => line.includes(`"${label}"`))?.match(/ref=(element:[a-f0-9]{64})/)?.[1] ?? '';
    const filled = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_fill_form', toolArgs: { pageRef: pageA, fields: [{ ref: find('Name'), value: 'Grace' }, { ref: find('Subscribe'), value: true }] } });
    const filledPage = 'pageRef' in filled ? filled.pageRef : '';
    const afterFill = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_snapshot', toolArgs: { pageRef: filledPage } });
    if (!('snapshot' in afterFill)) throw new Error('snapshot unavailable');
    const save = afterFill.snapshot.split('\n').find(line => line.includes('"Save"'))?.match(/ref=(element:[a-f0-9]{64})/)?.[1] ?? '';
    const clicked = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_click', toolArgs: { pageRef: filledPage, elementRef: save } });
    const clickedPage = 'pageRef' in clicked ? clicked.pageRef : '';
    const finalA = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_snapshot', toolArgs: { pageRef: clickedPage } });
    expect('snapshot' in finalA && finalA.snapshot).toContain('Saved 1');
    const shot = await adapter.invoke(context(A, 'run-a'), { toolName: 'browser_take_screenshot', toolArgs: { pageRef: clickedPage, fullPage: true } });
    expect('workspacePath' in shot && files.has(shot.workspacePath)).toBe(true);
    expect('mime' in shot && shot.mime).toBe('image/png');

    const openB = await adapter.invoke(context(B, 'run-b'), { toolName: 'browser_navigate', toolArgs: { url } });
    const pageB = 'pageRef' in openB ? openB.pageRef : '';
    const snapB = await adapter.invoke(context(B, 'run-b'), { toolName: 'browser_snapshot', toolArgs: { pageRef: pageB } });
    expect('snapshot' in snapB && snapB.snapshot).toContain('Saved 0');
  }, 120_000);

  it('renders desktop/mobile workspace previews with actual CSP blocking network requests', async () => {
    const files = new Map<string,string>();
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><main><h1>Preview fixture</h1><output id="result">Pending</output><img src="${url}/csp-leak-image"><script>fetch('${url}/csp-leak-fetch').then(()=>document.querySelector('#result').textContent='NETWORK ALLOWED').catch(()=>document.querySelector('#result').textContent='CSP BLOCKED');</script></main>`;
    files.set('/workspace/web-artifact/preview.html',Buffer.from(html).toString('base64'));
    const owner = {resolve:async()=>({sessionId:'preview-fixture',expiresAt:Date.now()+60000})} as unknown as NativeSessionOwner;
    const authority: Pick<ToolExecutionAuthority,'check'> = {check:async()=>({allowed:true})};
    const receipts: BrowserExecutionReceipts = {async claim(){return {kind:'claimed'};},async succeed(){},async markUnconfirmed(){}};
    const network: BrowserNetworkPolicy = {async assertAllowed(candidate){if(new URL(candidate).origin!==new URL(url).origin)throw new Error('blocked');}};
    const adapter = new PlaywrightMcpBrowserAdapter(owner,()=>({async write(file){files.set(file.path,file.contentBase64);return {};},async read(path){const contentBase64=files.get(path);if(!contentBase64)throw new Error('missing');return {path,contentBase64,sizeBytes:Buffer.from(contentBase64,'base64').length};}}),authority,receipts,network,observedFactory(network));
    adapters.push(adapter);
    const context=()=>({orgId:'org' as never,parentRunId:'preview-run',attemptId:'preview-run:0',leaseEpoch:1,bindingId:A,toolCallId:randomUUID()});
    const before=externalRequests;
    for(const viewport of ['desktop','mobile'] as const){
      const result=await adapter.invoke(context(),{toolName:'browser_navigate',toolArgs:{url:`https://preview.workspacex.invalid/workspace/web-artifact/preview.html?viewport=${viewport}`}});
      if(!('pageRef' in result))throw new Error('preview unavailable');
      const snapshot=await adapter.invoke(context(),{toolName:'browser_snapshot',toolArgs:{pageRef:result.pageRef}});
      expect('snapshot' in snapshot&&snapshot.snapshot).toContain('CSP BLOCKED');
      const screenshot=await adapter.invoke(context(),{toolName:'browser_take_screenshot',toolArgs:{pageRef:result.pageRef,fullPage:false}});
      if(!('workspacePath' in screenshot))throw new Error('screenshot unavailable');
      const png=Buffer.from(files.get(screenshot.workspacePath)!,'base64');
      expect(png.readUInt32BE(16)).toBe(viewport==='mobile'?L.mobileViewportWidth:L.viewportWidth);
      expect(png.readUInt32BE(20)).toBe(viewport==='mobile'?L.mobileViewportHeight:L.viewportHeight);
    }
    expect(externalRequests).toBe(before);
  },120000);

  it.skipIf(!process.env.WX_NATIVE_SANDBOX_CONTAINER)('persists screenshot bytes through the real isolated session and independently reads them back', async () => {
    const container = process.env.WX_NATIVE_SANDBOX_CONTAINER!;
    const directory = await mkdtemp(join(tmpdir(), 'wx-browser-session-'));
    const socketPath = join(directory, 'relay.sock');
    const fixture = await readFile(resolve(process.cwd(), '../deep-agent-service/tests/native_sandbox_fixture.py'), 'utf8');
    const relayCode = fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];
    if (!relayCode) throw new Error('existing sandbox relay missing');
    const relay = createServer(async (request, response) => {
      try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const output = await new Promise<string>((resolveOutput, reject) => {
          const child = spawn('docker', ['exec', '-i', container, 'node', '-e', relayCode]);
          let out = '';
          const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
          child.stdout.on('data', chunk => { out += chunk; if (out.length > 16 * 1024 * 1024) child.kill('SIGKILL'); });
          child.stderr.resume();
          child.on('error', reject);
          child.on('close', code => { clearTimeout(timer); code === 0 ? resolveOutput(out) : reject(new Error('sandbox relay failed')); });
          child.stdin.end(JSON.stringify({ method: request.method, path: request.url, headers: request.headers, body }));
        });
        const result = JSON.parse(output) as { status: number; body: string };
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(result.body);
      } catch { response.writeHead(503); response.end('{}'); }
    });
    await new Promise<void>(resolveListen => relay.listen(socketPath, resolveListen));
    const transport = createNativeSessionTransport(socketPath);
    let session: Awaited<ReturnType<typeof transport.create>> | undefined;
    let adapter: PlaywrightMcpBrowserAdapter | undefined;
    try {
      session = await transport.create([]);
      const bound: NativeResolved = { ...session, interruptOn: {}, packageDigest: 'a'.repeat(64), inputs: [] };
      const owner: NativeSessionOwner = { resolve: async () => bound, provision: async () => { throw new Error('not used'); }, release: async () => { throw new Error('not used'); }, releaseForRun: async () => { throw new Error('not used'); } };
      const authority: Pick<ToolExecutionAuthority, 'check'> = { check: async () => ({ allowed: true }) };
      const network: BrowserNetworkPolicy = { async assertAllowed(candidate) { if (new URL(candidate).origin !== new URL(url).origin) throw new Error('blocked'); } };
      adapter = new PlaywrightMcpBrowserAdapter(owner, value => createNativeDraftSession({ socketPath, ...value }), authority, { async claim() { return { kind: 'claimed' }; }, async succeed() {}, async markUnconfirmed() {} }, network, observedFactory(network));
      const context = () => ({ orgId: 'org' as never, parentRunId: 'real-browser-session', attemptId: 'real-browser-session:0', leaseEpoch: 1, bindingId: A, toolCallId: randomUUID() });
      const opened = await adapter.invoke(context(), { toolName: 'browser_navigate', toolArgs: { url } });
      if (!('pageRef' in opened)) throw new Error('page ref missing');
      const shot = await adapter.invoke(context(), { toolName: 'browser_take_screenshot', toolArgs: { pageRef: opened.pageRef, fullPage: true } });
      if (!('workspacePath' in shot)) throw new Error('screenshot missing');
      const bytes = schemas.file.parse(await createNativeDraftSession({ socketPath, ...session }).read(shot.workspacePath));
      const png = Buffer.from(bytes.contentBase64, 'base64');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.length).toBe(shot.sizeBytes);
      expect(createHash('sha256').update(png).digest('hex')).toBe(shot.sha256);
      expect(png.readUInt32BE(16)).toBe(shot.width);
      expect(png.readUInt32BE(20)).toBe(shot.height);
      await transport.destroy(session.sessionId, session.token);
      await expect(createNativeDraftSession({ socketPath, ...session }).read(shot.workspacePath)).rejects.toThrow();
      session = undefined;
    } finally {
      try { await adapter?.release(A); }
      finally {
        try { if (session) await transport.destroy(session.sessionId, session.token); }
        finally { await new Promise<void>(resolveClose => relay.close(() => resolveClose())); await rm(directory, { recursive: true, force: true }); }
      }
    }
  }, 120_000);

});

// This suite uses the actual controlled runtime. The local relay observes only
// session lifecycle headers for deterministic fixtures, never credentials/content.
describe.skipIf(!process.env.WX_BROWSER_RUNTIME_ENDPOINT)('W10 remote release lifecycle',()=>{
  async function fixture(){
    const endpoint=new URL(process.env.WX_BROWSER_RUNTIME_ENDPOINT!);const ids:string[]=[];const deleted:string[]=[];
    const relay=createServer((req,res)=>{
      if(req.method==='DELETE')deleted.push(String(req.headers['mcp-session-id']));
      const upstream=httpRequest(endpoint,{method:req.method,headers:{...req.headers,host:endpoint.host}},incoming=>{
        const id=incoming.headers['mcp-session-id'];if(typeof id==='string'&&!ids.includes(id))ids.push(id);
        res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);
      });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
    });await new Promise<void>(done=>relay.listen(0,'127.0.0.1',done));
    const address=relay.address();if(!address||typeof address==='string')throw new Error('relay missing');
    const url=`http://127.0.0.1:${address.port}/mcp`;
    return {ids,deleted,url,factory:new RemotePlaywrightMcpSessionFactory(url),async stop(){relay.closeAllConnections();await new Promise<void>(done=>relay.close(()=>done()));}};
  }
  it('acknowledges DELETE, invalidates the old session and preserves another isolated context',async()=>{
    const f=await fixture();const sessions:Awaited<ReturnType<typeof f.factory.create>>[]=[];
    try{
      const first=await f.factory.create('first');sessions.push(first);const firstId=f.ids[0]!;
      const second=await f.factory.create('second');sessions.push(second);expect(f.ids).toHaveLength(2);
      const url='https://preview.workspacex.invalid/workspace/web-artifact/lifecycle.html?viewport=desktop';
      for(const [session,title] of [[first,'Alpha fixture'],[second,'Beta fixture']] as const){
        await session.call('browser_route',{pattern:url,status:200,body:`<title>${title}</title><h1>${title}</h1>`,contentType:'text/html'},AbortSignal.timeout(30000));
        await session.call('browser_navigate',{url},AbortSignal.timeout(30000));
      }
      expect(JSON.stringify(await first.call('browser_snapshot',{},AbortSignal.timeout(30000)))).toContain('Alpha fixture');
      expect(JSON.stringify(await second.call('browser_snapshot',{},AbortSignal.timeout(30000)))).toContain('Beta fixture');
      await Promise.all([first.close(),first.close()]);expect(f.deleted.filter(id=>id===firstId)).toHaveLength(1);
      const old=await fetch(f.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-session-id':firstId},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/list',params:{}})});expect(old.status).toBe(404);await old.body?.cancel();
      expect(JSON.stringify(await second.call('browser_snapshot',{},AbortSignal.timeout(30000)))).toContain('Beta fixture');
      await second.close();expect(f.deleted).toHaveLength(2);
    }finally{await Promise.allSettled(sessions.map(session=>session.close()));await f.stop();}
  });
  it('deletes an initialized remote session when schema discovery fails before the first browser call',async()=>{
    const f=await fixture();const discovery=vi.spyOn(Client.prototype,'listTools').mockResolvedValue({tools:[]});
    try{
      await expect(f.factory.create('schema-failure')).rejects.toThrow();
      expect(f.ids).toHaveLength(1);expect(f.deleted).toEqual(f.ids);
      const old=await fetch(f.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-session-id':f.ids[0]!},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/list',params:{}})});expect(old.status).toBe(404);await old.body?.cancel();
    }finally{discovery.mockRestore();await f.stop();}
  });
  it('does not report remote termination for 405 or a bounded DELETE timeout',async()=>{
    const f=await fixture(),realFetch=globalThis.fetch,realTimeout=AbortSignal.timeout.bind(AbortSignal);
    try{
      for(const mode of ['405','timeout'] as const){
        const session=await f.factory.create(mode);const id=f.ids.at(-1)!;
        const timeoutSpy=vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>realTimeout(30));
        const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
          if(init?.method!=='DELETE')return realFetch(input,init);
          if(mode==='405')return new Response('',{status:405});
          return new Promise<Response>((_resolve,reject)=>{const signal=init.signal;if(!signal)throw new Error('missing independent deadline');if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
        });
        try{await expect(session.close()).rejects.toThrow();}
        finally{fetchSpy.mockRestore();timeoutSpy.mockRestore();}
        // Test teardown explicitly deletes the still-existing remote session.
        const cleanup=await realFetch(f.url,{method:'DELETE',headers:{'mcp-session-id':id}});expect(cleanup.status).toBe(200);await cleanup.body?.cancel();
      }
    }finally{vi.restoreAllMocks();await f.stop();}
  });
});
