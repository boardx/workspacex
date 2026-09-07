import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeSessionOwner, NativeResolved } from '../../src/application/agent-run/native-session-owner';
import type { ToolExecutionAuthority } from '../../src/application/agent-run/tool-execution-authority';
import {
  PlaywrightMcpBrowserAdapter,
  PublicBrowserNetworkPolicy,
  RemotePlaywrightMcpSessionFactory,
  type BrowserMcpSessionFactory,
} from '../../src/infrastructure/agent-run/playwright-mcp-browser-adapter';
import { StandardBrowserToolsController } from '../../src/interface/controllers/standard-browser-tools.controller';
import type {
  BrowserExecutionReceipts,
  BrowserInvocationOutput,
  StandardBrowserService,
} from '../../src/application/agent-run/standard-browser-tools';

const BINDING_A = '00000000-0000-4000-8000-000000000001';
const BINDING_B = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000500000002d0', 'hex');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function fixture(options: { imageResponse?: boolean; networkDenied?: boolean } = {}) {
  let allowed = true;
  let failNext: string | null = null;
  const calls = new Map<string, { name: string; args: Record<string, unknown> }[]>();
  const factory: BrowserMcpSessionFactory = {
    async create(key) {
      const outputDir = await mkdtemp(join(tmpdir(), `browser-unit-${key.slice(0, 8)}-`));
      roots.push(outputDir);
      const sessionCalls: { name: string; args: Record<string, unknown> }[] = [];
      calls.set(key, sessionCalls);
      return {
        outputDir: options.imageResponse ? null : outputDir,
        async call(name, args) {
          sessionCalls.push({ name, args });
          if (failNext === name) { failNext = null; throw new Error('transport outcome unknown'); }
          if (name === 'browser_take_screenshot') {
            if (options.imageResponse) return { content: [{ type: 'text', text: 'screenshot captured' }, { type: 'image', mimeType: 'image/png', data: png.toString('base64') }] };
            await writeFile(join(outputDir, String(args.filename)), png);
          }
          const text = '- Page URL: https://example.com/form\n- Page Title: Form\n### Snapshot\n- textbox "Name" [ref=e1]\n- checkbox "Subscribe" [ref=e2]\n- button "Save" [ref=e3]';
          return { content: [{ type: 'text', text }] };
        },
        async close() {},
      };
    },
  };
  const resolved = { sessionId: 'session', expiresAt: Date.now() + 60_000 } as unknown as NativeResolved;
  const owner = { resolve: async () => resolved } as unknown as NativeSessionOwner;
  const files = new Map<string, string>();
  const workspace = {
    async write(file: { path: string; contentBase64: string }) { files.set(file.path, file.contentBase64); return {}; },
    async read(path: string) {
      const contentBase64 = files.get(path);
      if (!contentBase64) throw new Error('missing');
      return { path, contentBase64, sizeBytes: Buffer.from(contentBase64, 'base64').length };
    },
  };
  const authority = { check: async () => ({ allowed, reason: allowed ? 'allowed' : 'approval_required' }) } as unknown as Pick<ToolExecutionAuthority, 'check'>;
  const rows = new Map<string, { tool: string; digest: string; status: 'pending' | 'succeeded' | 'unconfirmed'; result?: BrowserInvocationOutput }>();
  const receipts: BrowserExecutionReceipts = {
    async claim(context, invocation, digest) {
      const key = `${context.orgId}:${context.parentRunId}:${context.toolCallId}`;
      const prior = rows.get(key);
      if (!prior) { rows.set(key, { tool: invocation.toolName, digest, status: 'pending' }); return { kind: 'claimed' }; }
      if (prior.tool !== invocation.toolName || prior.digest !== digest) throw new Error('browser_receipt_conflict');
      return prior.status === 'succeeded' ? { kind: 'succeeded', result: prior.result as BrowserInvocationOutput } : { kind: 'unconfirmed' };
    },
    async succeed(context, invocation, digest, result) {
      rows.set(`${context.orgId}:${context.parentRunId}:${context.toolCallId}`, { tool: invocation.toolName, digest, status: 'succeeded', result });
    },
    async markUnconfirmed(context, invocation, digest) {
      const key = `${context.orgId}:${context.parentRunId}:${context.toolCallId}`;
      if (rows.get(key)?.status === 'pending') rows.set(key, { tool: invocation.toolName, digest, status: 'unconfirmed' });
    },
  };
  const network = { async assertAllowed() { if (options.networkDenied) throw new Error('browser_network_denied'); } };
  const adapter = new PlaywrightMcpBrowserAdapter(owner, () => workspace, authority, receipts, network, factory);
  let sequence = 0;
  const context = (bindingId: string, run: string, toolCallId = `${run}-call-${++sequence}`) =>
    ({ orgId: 'org' as never, parentRunId: run, attemptId: `${run}:0`, leaseEpoch: 1, bindingId, toolCallId });
  return { adapter, calls, files, context, rows, deny: () => { allowed = false; }, fail: (name: string) => { failNext = name; } };
}

function refFor(snapshot: string, label: string): string {
  const line = snapshot.split('\n').find(value => value.includes(`"${label}"`));
  const ref = line?.match(/ref=(element:[a-f0-9]{64})/)?.[1];
  if (!ref) throw new Error(`missing ${label}`);
  return ref;
}

describe('Playwright MCP browser adapter contract', () => {
  it('controller accepts only the internal authenticated canonical invocation', async () => {
    const previous = process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
    process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = 'browser-test-key';
    const seen: unknown[] = [];
    const service = { invoke: async (...args: unknown[]) => { seen.push(args); return { pageRef: `page:${'f'.repeat(64)}`, url: 'https://example.com/', title: 'Example', generation: 1 }; }, release: async () => undefined } as StandardBrowserService;
    const controller = new StandardBrowserToolsController(service);
    try {
      const output = await controller.invoke('browser-test-key', 'run-a', { orgId: 'org', attemptId: 'run-a:0', leaseEpoch: 1, bindingId: BINDING_A, toolCallId: 'call-a', toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
      expect(output).toMatchObject({ generation: 1 });
      expect(seen).toHaveLength(1);
      await expect(controller.invoke('wrong', 'run-a', {})).rejects.toMatchObject({ status: 401 });
    } finally {
      if (previous === undefined) delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
      else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = previous;
    }
  });

  it('keeps opaque refs run-bound and invalidates them after an action', async () => {
    const { adapter, calls, context } = fixture();
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/form' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    const snapshot = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_snapshot', toolArgs: { pageRef } });
    if (!('snapshot' in snapshot)) throw new Error('expected snapshot');
    expect(snapshot.snapshot).not.toContain('ref=e1');
    const save = refFor(snapshot.snapshot, 'Save');
    const clicked = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_click', toolArgs: { pageRef, elementRef: save } });
    const nextPageRef = 'pageRef' in clicked ? clicked.pageRef : '';
    expect(nextPageRef).not.toBe(pageRef);
    await expect(adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_click', toolArgs: { pageRef, elementRef: save } })).rejects.toThrow('unconfirmed_no_replay');
    await expect(adapter.invoke(context(BINDING_B, 'run-b'), { toolName: 'browser_click', toolArgs: { pageRef: nextPageRef, elementRef: save } })).rejects.toThrow('unconfirmed_no_replay');
    expect([...calls.values()].flat().filter(call => call.name === 'browser_click')).toHaveLength(1);
  });

  it('does not call Playwright MCP when dispatch authorization is denied', async () => {
    const { adapter, calls, context, deny } = fixture();
    deny();
    await expect(adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('denied');
    expect(calls.size).toBe(0);
  });

  it('does not call Playwright MCP when the public-network gate rejects navigation', async () => {
    const { adapter, calls, context } = fixture({ networkDenied: true });
    await expect(adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('unconfirmed_no_replay');
    expect([...calls.values()].flat().filter(call => call.name === 'browser_navigate')).toHaveLength(0);
  });

  it('returns a durable success receipt without dispatching the same toolCallId twice', async () => {
    const { adapter, calls, context } = fixture();
    const sameCall = context(BINDING_A, 'run-a', 'same-navigate-call');
    const first = await adapter.invoke(sameCall, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    const replay = await adapter.invoke(sameCall, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    expect(replay).toEqual(first);
    expect([...calls.values()].flat().filter(call => call.name === 'browser_navigate')).toHaveLength(1);
  });

  it('persists an unknown outcome and refuses to replay its side effect', async () => {
    const { adapter, calls, context, fail } = fixture();
    const sameCall = context(BINDING_A, 'run-a', 'unknown-navigate-call');
    fail('browser_navigate');
    await expect(adapter.invoke(sameCall, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('unconfirmed_no_replay');
    await expect(adapter.invoke(sameCall, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('unconfirmed_no_replay');
    expect([...calls.values()].flat().filter(call => call.name === 'browser_navigate')).toHaveLength(1);
  });

  it('maps fill fields to upstream metadata and writes a verified screenshot to this workspace', async () => {
    const { adapter, calls, files, context } = fixture();
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/form' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    const snapshot = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_snapshot', toolArgs: { pageRef } });
    if (!('snapshot' in snapshot)) throw new Error('expected snapshot');
    const nameRef = refFor(snapshot.snapshot, 'Name');
    const subscribedRef = refFor(snapshot.snapshot, 'Subscribe');
    const filled = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_fill_form', toolArgs: { pageRef, fields: [{ ref: nameRef, value: 'Grace' }, { ref: subscribedRef, value: true }] } });
    const nextPageRef = 'pageRef' in filled ? filled.pageRef : '';
    const screenshot = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_take_screenshot', toolArgs: { pageRef: nextPageRef } });
    if (!('workspacePath' in screenshot)) throw new Error('expected screenshot');
    expect(screenshot).toMatchObject({ mime: 'image/png', width: 1280, height: 720, sizeBytes: png.length });
    expect(files.get(screenshot.workspacePath)).toBe(png.toString('base64'));
    const allCalls = [...calls.values()].flat();
    expect(allCalls.find(call => call.name === 'browser_fill_form')?.args).toEqual({ fields: [
      { target: 'e1', name: 'Name', type: 'textbox', value: 'Grace' },
      { target: 'e2', name: 'Subscribe', type: 'checkbox', value: true },
    ] });
  });

  it('accepts the production remote runtime PNG response without a shared output directory', async () => {
    const { adapter, files, context } = fixture({ imageResponse: true });
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/form' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    const screenshot = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_take_screenshot', toolArgs: { pageRef } });
    if (!('workspacePath' in screenshot)) throw new Error('expected screenshot');
    expect(files.get(screenshot.workspacePath)).toBe(png.toString('base64'));
    expect(screenshot).toMatchObject({ width: 1280, height: 720, mime: 'image/png' });
  });

  it('production network policy rejects loopback and private literals', async () => {
    const policy = new PublicBrowserNetworkPolicy();
    await expect(policy.assertAllowed('http://127.0.0.1:3000')).rejects.toThrow('denied');
    await expect(policy.assertAllowed('http://[::1]/')).rejects.toThrow('denied');
    await expect(policy.assertAllowed('http://169.254.169.254/latest/meta-data')).rejects.toThrow('denied');
    const canonical = new URL('http://[::ffff:127.0.0.1]/').hostname;
    expect(canonical).toBe('[::ffff:7f00:1]');
    await expect(policy.assertAllowed('http://[::ffff:127.0.0.1]/')).rejects.toThrow('denied');
    await expect(policy.assertAllowed('http://[64:ff9b::a9fe:a9fe]/')).rejects.toThrow('denied');
    const rebound = new PublicBrowserNetworkPolicy(async () => ['::ffff:7f00:1']);
    await expect(rebound.assertAllowed('https://public-looking.example/')).rejects.toThrow('denied');
  });

  it('allows the production MCP client to target loopback runtime only', () => {
    expect(() => new RemotePlaywrightMcpSessionFactory('http://127.0.0.1:58931/mcp')).not.toThrow();
    expect(() => new RemotePlaywrightMcpSessionFactory('https://browser.example/mcp')).toThrow('endpoint_denied');
    expect(() => new RemotePlaywrightMcpSessionFactory('http://127.0.0.1:58931/other')).toThrow('endpoint_denied');
  });
});
