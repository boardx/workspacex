import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NativeSessionOwner, NativeResolved } from '../../src/application/agent-run/native-session-owner';
import type { ToolExecutionAuthority } from '../../src/application/agent-run/tool-execution-authority';
import {
  OfficialPlaywrightMcpSessionFactory,
  PlaywrightMcpBrowserAdapter,
  type BrowserNetworkPolicy,
} from '../../src/infrastructure/agent-run/playwright-mcp-browser-adapter';

const enabled = process.env.WORKSPACEX_REAL_BROWSER === '1';
const suite = enabled ? describe : describe.skip;
const A = '00000000-0000-4000-8000-000000000011';
const B = '00000000-0000-4000-8000-000000000012';

suite('W10 real Playwright MCP and Chromium acceptance', () => {
  let server: Server;
  let url: string;
  const adapters: PlaywrightMcpBrowserAdapter[] = [];

  beforeAll(async () => {
    server = createServer((_request, response) => {
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
    const workspace = {
      async write(file: { path: string; contentBase64: string }) { files.set(file.path, file.contentBase64); return {}; },
      async read(path: string) { const contentBase64 = files.get(path); if (!contentBase64) throw new Error('missing'); return { path, contentBase64, sizeBytes: Buffer.from(contentBase64, 'base64').length }; },
    };
    const adapter = new PlaywrightMcpBrowserAdapter(owner, () => workspace, authority, new OfficialPlaywrightMcpSessionFactory(allowFixture));
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
});
