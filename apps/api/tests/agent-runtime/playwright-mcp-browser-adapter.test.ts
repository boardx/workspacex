import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
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
  BrowserFailureClass,
  BrowserInvocationOutput,
  StandardBrowserService,
} from '../../src/application/agent-run/standard-browser-tools';
import { STANDARD_BROWSER_LIMITS as L } from '@repo/contracts/standard-browser-tools';

const BINDING_A = '00000000-0000-4000-8000-000000000001';
const BINDING_B = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000500000002d0', 'hex');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function fixture(options: {
  imageResponse?: boolean;
  networkDenied?: boolean;
  createGate?: Promise<void>;
  onCreate?: () => void;
  deadlineSignal?: () => AbortSignal;
  callGate?: { name: string; started: () => void; wait: Promise<void> };
  snapshotBody?: string;
  createFailure?: Error;
} = {}) {
  let allowed = true;
  let failNext: string | null = null;
  let denyAfter: string | null = null;
  const calls = new Map<string, { name: string; args: Record<string, unknown> }[]>();
  const factory: BrowserMcpSessionFactory = {
    async create(key) {
      options.onCreate?.();
      if (options.createGate) await options.createGate;
      if (options.createFailure) throw options.createFailure;
      const outputDir = await mkdtemp(join(tmpdir(), `browser-unit-${key.slice(0, 8)}-`));
      roots.push(outputDir);
      const sessionCalls: { name: string; args: Record<string, unknown> }[] = [];
      let currentUrl = 'https://example.com/form';
      calls.set(key, sessionCalls);
      return {
        outputDir: options.imageResponse ? null : outputDir,
        async call(name, args) {
          sessionCalls.push({ name, args });
          if (options.callGate?.name === name) { options.callGate.started(); await options.callGate.wait; }
          if (failNext === name) { failNext = null; throw new Error('transport outcome unknown'); }
          if (name === 'browser_navigate') currentUrl = String(args.url);
          if (name === 'browser_take_screenshot') {
            if (options.imageResponse) return { content: [{ type: 'text', text: 'screenshot captured' }, { type: 'image', mimeType: 'image/png', data: png.toString('base64') }] };
            await writeFile(String(args.filename), png);
          }
          const snapshot = name === 'browser_snapshot' && options.snapshotBody
            ? options.snapshotBody
            : '- textbox "Name" [ref=e1]\n- checkbox "Subscribe" [ref=e2]\n- button "Save" [ref=e3]';
          const text = `- Page URL: ${currentUrl}\n- Page Title: Form\n### Snapshot\n${snapshot}`;
          if (denyAfter === name) { denyAfter = null; allowed = false; }
          return { content: [{ type: 'text', text }] };
        },
        async close() {},
      };
    },
  };
  const owner = { resolve: async (bindingId: string) => ({ sessionId: bindingId, expiresAt: Date.now() + 60_000 }) as unknown as NativeResolved } as unknown as NativeSessionOwner;
  const filesByBinding = new Map<string, Map<string, string>>();
  const bindingFiles = (bindingId: string) => {
    let value = filesByBinding.get(bindingId);
    if (!value) { value = new Map(); filesByBinding.set(bindingId, value); }
    return value;
  };
  const files = bindingFiles(BINDING_A);
  const workspace = (bound: NativeResolved) => ({
    async write(file: { path: string; contentBase64: string }) { bindingFiles(bound.sessionId).set(file.path, file.contentBase64); return {}; },
    async read(path: string) {
      const contentBase64 = bindingFiles(bound.sessionId).get(path);
      if (!contentBase64) throw new Error('missing');
      return { path, contentBase64, sizeBytes: Buffer.from(contentBase64, 'base64').length };
    },
  });
  const authority = { check: async () => ({ allowed, reason: allowed ? 'allowed' : 'approval_required' }) } as unknown as Pick<ToolExecutionAuthority, 'check'>;
  const rows = new Map<string, { tool: string; digest: string; status: 'pending' | 'succeeded' | 'unconfirmed'; result?: BrowserInvocationOutput; failure?: BrowserFailureClass }>();
  const failures: BrowserFailureClass[] = [];
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
    async markUnconfirmed(context, invocation, digest, failure) {
      const key = `${context.orgId}:${context.parentRunId}:${context.toolCallId}`;
      failures.push(failure);
      if (rows.get(key)?.status === 'pending') rows.set(key, { tool: invocation.toolName, digest, status: 'unconfirmed', failure });
    },
  };
  const network = { async assertAllowed() { if (options.networkDenied) throw new Error('browser_network_denied'); } };
  const adapter = new PlaywrightMcpBrowserAdapter(owner, workspace, authority, receipts, network, factory, options.deadlineSignal);
  let sequence = 0;
  const context = (bindingId: string, run: string, toolCallId = `${run}-call-${++sequence}`) =>
    ({ orgId: 'org' as never, parentRunId: run, attemptId: `${run}:0`, leaseEpoch: 1, bindingId, toolCallId });
  return {
    adapter, calls, files, context, rows, failures,
    putFile: (path: string, content: string) => files.set(path, Buffer.from(content).toString('base64')),
    putFileFor: (bindingId: string, path: string, content: string) => bindingFiles(bindingId).set(path, Buffer.from(content).toString('base64')),
    deny: () => { allowed = false; }, denyAfter: (name: string) => { denyAfter = name; },
    fail: (name: string) => { failNext = name; },
  };
}

/** The reason chain the adapter used to discard at the language level (`catch {`). */
function causeMessages(error: unknown): string[] {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error && messages.length < 8; current = current.cause) {
    messages.push(current.message);
  }
  return messages;
}

async function rejection(action: Promise<unknown>): Promise<unknown> {
  try { await action; } catch (error) { return error; }
  throw new Error('expected a rejection');
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
    const { adapter, calls, context, rows } = fixture({ networkDenied: true });
    await expect(adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('browser_network_denied');
    expect([...calls.values()].flat().filter(call => call.name === 'browser_navigate')).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('does not turn a successful navigation into an unknown outcome by eagerly reading a large page snapshot', async () => {
    const largePage = Array.from({ length: 4_000 }, (_, index) => `- paragraph "section ${index} ${'x'.repeat(80)}" [ref=e${index}]`).join('\n');
    const { adapter, calls, context, rows } = fixture({ snapshotBody: largePage });
    const call = context(BINDING_A, 'run-a', 'large-page-navigate');

    const opened = await adapter.invoke(call, {
      toolName: 'browser_navigate', toolArgs: { url: 'https://zh.wikipedia.org/wiki/人工智能' },
    });

    expect(opened).toMatchObject({ title: 'Form', url: 'https://zh.wikipedia.org/wiki/人工智能' });
    expect([...calls.values()].flat().map(item => item.name)).toEqual(['browser_resize', 'browser_navigate']);
    expect(rows.get('org:run-a:large-page-navigate')?.status).toBe('succeeded');
  });

  it('returns an explicitly marked complete-line prefix when a page snapshot exceeds the contract limit', async () => {
    const largePage = Array.from({ length: 4_000 }, (_, index) => `- paragraph "section ${index} ${'x'.repeat(80)}" [ref=e${index}]`).join('\n');
    const { adapter, context } = fixture({ snapshotBody: largePage });
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://zh.wikipedia.org/wiki/人工智能' },
    });
    if (!('pageRef' in opened)) throw new Error('expected page ref');

    const result = await adapter.invoke(context(BINDING_A, 'run-a'), {
      toolName: 'browser_snapshot', toolArgs: { pageRef: opened.pageRef },
    });

    if (!('snapshot' in result)) throw new Error('expected snapshot');
    expect(result.snapshot.length).toBeLessThanOrEqual(L.maxSnapshotChars);
    expect(result.snapshot).toContain('section 0');
    expect(result.snapshot.endsWith(`\n# Snapshot truncated to ${L.maxSnapshotChars} characters.`)).toBe(true);
    expect(result.snapshot.at(-1)).toBe('.');
    expect(result.elements.every(({ elementRef }) => result.snapshot.includes(elementRef))).toBe(true);
  });

  it('covers browser state creation with the action deadline', async () => {
    const controller = new AbortController();
    let releaseCreate!: () => void;
    let created!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const createStarted = new Promise<void>(resolve => { created = resolve; });
    const { adapter, calls, context } = fixture({ createGate, onCreate: created, deadlineSignal: () => controller.signal });
    const pending = adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    await createStarted;
    controller.abort();
    await expect(pending).rejects.toThrow('unconfirmed_no_replay');
    expect(calls.size).toBe(0);
    releaseCreate();
  });

  it('expires while waiting in the serial queue without dispatching out of order', async () => {
    const firstSignal = new AbortController();
    const queuedSignal = new AbortController();
    let invocation = 0;
    let unblock!: () => void;
    let blocked!: () => void;
    const wait = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { blocked = resolve; });
    const { adapter, calls, context } = fixture({
      deadlineSignal: () => (++invocation === 1 ? firstSignal.signal : queuedSignal.signal),
      callGate: { name: 'browser_navigate', started: blocked, wait },
    });
    const first = adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/first' } });
    await started;
    const queued = adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/queued' } });
    await new Promise<void>(resolve => setImmediate(resolve));
    queuedSignal.abort();
    await expect(queued).rejects.toThrow('unconfirmed_no_replay');
    unblock();
    await first;
    expect([...calls.values()].flat().filter(call => call.name === 'browser_navigate')).toHaveLength(1);
  });

  it('does not snapshot or publish a success receipt after authorization is revoked post-action', async () => {
    const { adapter, calls, context, rows, denyAfter } = fixture();
    denyAfter('browser_navigate');
    const call = context(BINDING_A, 'run-a', 'cancel-after-navigate');
    await expect(adapter.invoke(call, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } })).rejects.toThrow('unconfirmed_no_replay');
    const upstream = [...calls.values()].flat();
    expect(upstream.filter(item => item.name === 'browser_navigate')).toHaveLength(1);
    expect(upstream.filter(item => item.name === 'browser_snapshot')).toHaveLength(0);
    expect(rows.get('org:run-a:cancel-after-navigate')?.status).toBe('unconfirmed');
  });

  it('does not write a screenshot after authorization is revoked by the completed browser action', async () => {
    const { adapter, context, files, denyAfter } = fixture();
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    denyAfter('browser_take_screenshot');
    await expect(adapter.invoke(context(BINDING_A, 'run-a', 'cancel-after-shot'), {
      toolName: 'browser_take_screenshot', toolArgs: { pageRef },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(files.size).toBe(0);
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
      { target: 'e2', name: 'Subscribe', type: 'checkbox', value: 'true' },
    ] });
    expect(isAbsolute(String(allCalls.find(call => call.name === 'browser_take_screenshot')?.args.filename))).toBe(true);
  });

  it('loads an authorized self-contained workspace preview at only the fixed desktop/mobile viewports', async () => {
    const { adapter, calls, context, putFile } = fixture();
    putFile('/workspace/web-artifact/bundle.html', '<!doctype html><button>Preview</button>');
    const desktopUrl = 'https://preview.workspacex.invalid/workspace/web-artifact/bundle.html?viewport=desktop';
    const desktop = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: desktopUrl } });
    expect('url' in desktop && desktop.url).toBe(desktopUrl);
    const mobileUrl = 'https://preview.workspacex.invalid/workspace/web-artifact/bundle.html?viewport=mobile';
    const mobile = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: mobileUrl } });
    expect('url' in mobile && mobile.url).toBe(mobileUrl);
    const upstream = [...calls.values()].flat();
    expect(upstream.filter(call => call.name === 'browser_resize').map(call => call.args)).toEqual([
      { width: 1280, height: 720 }, { width: 390, height: 844 },
    ]);
    const navigations = upstream.filter(call => call.name === 'browser_navigate');
    expect(navigations).toHaveLength(2);
    expect(navigations.map(call => call.args.url)).toEqual([desktopUrl, mobileUrl]);
    expect(upstream.filter(call => call.name === 'browser_route')).toHaveLength(2);
    expect(upstream.filter(call => call.name === 'browser_unroute')).toHaveLength(2);
  });

  it('rejects malformed workspace preview paths before any MCP dispatch', async () => {
    const { adapter, calls, context } = fixture();
    await expect(adapter.invoke(context(BINDING_A, 'run-a'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://preview.workspacex.invalid/workspace/web-artifact/%2e%2e/secret.html?viewport=mobile' },
    })).rejects.toThrow();
    expect([...calls.values()].flat()).toHaveLength(0);
  });

  it('loads the same preview URL from each binding owner workspace without cross-run source reuse', async () => {
    const { adapter, calls, context, putFileFor } = fixture();
    const path = '/workspace/web-artifact/bundle.html';
    const url = 'https://preview.workspacex.invalid/workspace/web-artifact/bundle.html?viewport=desktop';
    putFileFor(BINDING_A, path, '<!doctype html><title>run-a-only</title>');
    putFileFor(BINDING_B, path, '<!doctype html><title>run-b-only</title>');
    await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url } });
    await adapter.invoke(context(BINDING_B, 'run-b'), { toolName: 'browser_navigate', toolArgs: { url } });
    const routeBodies = [...calls.values()].flat().filter(call => call.name === 'browser_route').map(call => String(call.args.body));
    expect(routeBodies).toHaveLength(2);
    expect(routeBodies[0]).toContain('run-a-only'); expect(routeBodies[0]).not.toContain('run-b-only');
    expect(routeBodies[1]).toContain('run-b-only'); expect(routeBodies[1]).not.toContain('run-a-only');
  });

  it('accepts the production remote runtime PNG response without a shared output directory', async () => {
    const { adapter, calls, files, context } = fixture({ imageResponse: true });
    const opened = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/form' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    const screenshot = await adapter.invoke(context(BINDING_A, 'run-a'), { toolName: 'browser_take_screenshot', toolArgs: { pageRef } });
    if (!('workspacePath' in screenshot)) throw new Error('expected screenshot');
    expect(files.get(screenshot.workspacePath)).toBe(png.toString('base64'));
    expect(screenshot).toMatchObject({ width: 1280, height: 720, mime: 'image/png' });
    expect([...calls.values()].flat().find(call => call.name === 'browser_take_screenshot')?.args).not.toHaveProperty('filename');
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
  // Regression: `PlaywrightMcpBrowserAdapter.invoke` used to end in a bare `catch {` that
  // rethrew one string with no `cause`, so a missing Chromium (BLOCKED) and a refused tool
  // call (FAIL) produced byte-identical evidence. Judging between them required patching a
  // `console.error` into the adapter -- which an acceptance reviewer cannot do.
  it('records why a browser outcome is unknown instead of collapsing every failure into one string', async () => {
    const launchFailure = new Error("browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell");
    const { adapter, context, rows, failures } = fixture({ createFailure: launchFailure });
    const call = context(BINDING_A, 'run-a', 'missing-chromium');
    const error = await rejection(adapter.invoke(call, { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } }));

    expect((error as Error).message).toBe('browser_execution_unconfirmed_no_replay');
    expect(causeMessages(error)).toContain(launchFailure.message);
    expect(failures).toEqual(['session_launch_failed']);
    expect(rows.get('org:run-a:missing-chromium')?.failure).toBe('session_launch_failed');
  });

  // Without this the classification degrades into a tautology: every unknown outcome would
  // answer `upstream_tool_error`, which is exactly as useless as one shared string.
  it('does not answer upstream_tool_error when the browser runtime never came up', async () => {
    const { adapter, context, failures } = fixture({ createFailure: new Error('spawn ENOENT') });
    await expect(adapter.invoke(context(BINDING_A, 'run-a', 'no-runtime'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(failures).toEqual(['session_launch_failed']);
    expect(failures).not.toContain('upstream_tool_error');
  });

  it('separates an upstream tool failure, a revoked authorization and a deadline', async () => {
    const upstream = fixture();
    upstream.fail('browser_navigate');
    await expect(upstream.adapter.invoke(upstream.context(BINDING_A, 'run-a', 'upstream'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(upstream.failures).toEqual(['upstream_tool_error']);

    const revoked = fixture();
    revoked.denyAfter('browser_navigate');
    await expect(revoked.adapter.invoke(revoked.context(BINDING_A, 'run-a', 'revoked'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(revoked.failures).toEqual(['policy_denied']);

    const controller = new AbortController();
    let created!: () => void;
    const createStarted = new Promise<void>(resolve => { created = resolve; });
    const expired = fixture({ createGate: new Promise<void>(() => {}), onCreate: created, deadlineSignal: () => controller.signal });
    const pending = expired.adapter.invoke(expired.context(BINDING_A, 'run-b', 'expired'), {
      toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' },
    });
    await createStarted;
    controller.abort();
    await expect(pending).rejects.toThrow('unconfirmed_no_replay');
    expect(expired.failures).toEqual(['timeout']);
  });

  it('classifies an oversize upstream response apart from a stale element handle', async () => {
    const oversize = fixture({ snapshotBody: 'x'.repeat(L.maxResponseBytes + 1) });
    const page = await oversize.adapter.invoke(oversize.context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    await expect(oversize.adapter.invoke(oversize.context(BINDING_A, 'run-a', 'oversize'), {
      toolName: 'browser_snapshot', toolArgs: { pageRef: 'pageRef' in page ? page.pageRef : '' },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(oversize.failures).toEqual(['oversize']);

    const stale = fixture();
    const opened = await stale.adapter.invoke(stale.context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com' } });
    const pageRef = 'pageRef' in opened ? opened.pageRef : '';
    await stale.adapter.invoke(stale.context(BINDING_A, 'run-a'), { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/next' } });
    await expect(stale.adapter.invoke(stale.context(BINDING_A, 'run-a', 'stale-page'), {
      toolName: 'browser_snapshot', toolArgs: { pageRef },
    })).rejects.toThrow('unconfirmed_no_replay');
    expect(stale.failures).toEqual(['stale_ref']);
  });
});
