import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createConnection } from '@playwright/mcp';
import { chromium, type Browser, type BrowserContext as PlaywrightBrowserContext } from 'playwright';
import type { z } from 'zod';
import {
  BrowserClickInput,
  BrowserClickOutput,
  BrowserFillFormInput,
  BrowserFillFormOutput,
  BrowserNavigateInput,
  BrowserNavigateOutput,
  BrowserScreenshotOutput,
  BrowserSnapshotInput,
  BrowserSnapshotOutput,
  BrowserTakeScreenshotInput,
  STANDARD_BROWSER_LIMITS as L,
} from '@repo/contracts/standard-browser-tools';
import { schemas } from '@repo/contracts/sandbox-session';
import type {
  BrowserContext,
  BrowserExecutionReceipts,
  BrowserInvocation,
  BrowserInvocationOutput,
  BrowserWorkspace,
  StandardBrowserService,
} from '../../application/agent-run/standard-browser-tools';
import type { NativeResolved, NativeSessionOwner } from '../../application/agent-run/native-session-owner';
import type { ToolExecutionAuthority } from '../../application/agent-run/tool-execution-authority';
import { classifyAddress } from '../../domain/skill/import-source';
import { mcpExecutionDigest } from '../mcp/mcp-execution-digest';

const REQUIRED_TOOLS = new Set(['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill_form', 'browser_take_screenshot']);
const ADAPTER_UPSTREAM_TOOLS = new Set([...REQUIRED_TOOLS, 'browser_resize', 'browser_route', 'browser_unroute']);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const opaque = (kind: 'page' | 'element') => `${kind}:${randomBytes(32).toString('hex')}`;

export interface BrowserNetworkPolicy {
  assertAllowed(url: string): Promise<void>;
}

export class PublicBrowserNetworkPolicy implements BrowserNetworkPolicy {
  constructor(private readonly resolve = async (hostname: string): Promise<readonly string[]> =>
    (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address)) {}

  async assertAllowed(raw: string): Promise<void> {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('browser_network_denied'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === 'localhost') {
      throw new Error('browser_network_denied');
    }
    const classification = classifyAddress(url.hostname);
    if (classification === 'blocked') throw new Error('browser_network_denied');
    if (classification === 'public') return;
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some(address => classifyAddress(address) !== 'public')) throw new Error('browser_network_denied');
  }
}

interface McpResult {
  content?: unknown[];
  isError?: boolean;
}

interface BrowserMcpSession {
  readonly outputDir: string | null;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpResult>;
  close(): Promise<void>;
}

function requiredKeys(schema: unknown): Set<string> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return new Set();
  const required = (schema as Record<string, unknown>).required;
  return new Set(Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : []);
}

function properties(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const value = (schema as Record<string, unknown>).properties;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertUpstreamSchemas(tools: readonly { name: string; inputSchema: unknown }[]): void {
  const byName = new Map(tools.map(tool => [tool.name, tool.inputSchema]));
  if ([...REQUIRED_TOOLS].some(name => !byName.has(name))) throw new Error('playwright_mcp_contract_changed');
  if (!requiredKeys(byName.get('browser_navigate')).has('url')) throw new Error('playwright_mcp_contract_changed');
  if (!requiredKeys(byName.get('browser_click')).has('target')) throw new Error('playwright_mcp_contract_changed');
  if (!requiredKeys(byName.get('browser_fill_form')).has('fields')) throw new Error('playwright_mcp_contract_changed');
  if (!['width', 'height'].every(key => requiredKeys(byName.get('browser_resize')).has(key))) throw new Error('playwright_mcp_contract_changed');
  if (!requiredKeys(byName.get('browser_route')).has('pattern')) throw new Error('playwright_mcp_contract_changed');
  if (!Object.hasOwn(properties(byName.get('browser_unroute')), 'pattern')) throw new Error('playwright_mcp_contract_changed');
  const screenshot = properties(byName.get('browser_take_screenshot'));
  if (!['filename', 'type', 'fullPage', 'scale'].every(key => Object.hasOwn(screenshot, key))) throw new Error('playwright_mcp_contract_changed');
}

export interface BrowserMcpSessionFactory {
  create(sessionKey: string): Promise<BrowserMcpSession>;
}

export class OfficialPlaywrightMcpSessionFactory implements BrowserMcpSessionFactory {
  constructor(
    private readonly network: BrowserNetworkPolicy,
    acknowledgement: { readonly allowInProcessBrowserWithoutNetworkNamespace: true },
  ) {
    if (acknowledgement.allowInProcessBrowserWithoutNetworkNamespace !== true) throw new Error('browser_runtime_boundary_required');
  }

  async create(_sessionKey: string): Promise<BrowserMcpSession> {
    const outputDir = await mkdtemp(join(tmpdir(), 'workspacex-browser-'));
    let browser: Browser | undefined;
    let context: PlaywrightBrowserContext | undefined;
    let client: Client | undefined;
    let server: Awaited<ReturnType<typeof createConnection>> | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ viewport: { width: L.viewportWidth, height: L.viewportHeight }, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        try {
          await this.network.assertAllowed(route.request().url());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      server = await createConnection({
        capabilities: 'core,network'.split(',') as ('core' | 'network')[],
        outputDir,
        outputMaxSize: 32 * 1024 * 1024,
        imageResponses: 'omit',
        codegen: 'none',
        snapshot: { mode: 'full' },
        timeouts: { action: 10_000, navigation: L.deadlineMs, expect: 5_000, settle: 250 },
      }, async () => context as PlaywrightBrowserContext);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      client = new Client({ name: 'workspacex-browser-adapter', version: '1.0.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      assertUpstreamSchemas(listed.tools);
      const activeClient = client;
      return {
        outputDir,
        async call(name, args, signal) {
          if (!ADAPTER_UPSTREAM_TOOLS.has(name)) throw new Error('browser_tool_not_allowed');
          return await activeClient.callTool({ name, arguments: args }, undefined, { signal, timeout: L.deadlineMs, maxTotalTimeout: L.deadlineMs }) as McpResult;
        },
        async close() {
          await activeClient.close().catch(() => undefined);
          await context?.close().catch(() => undefined);
          await browser?.close().catch(() => undefined);
          await rm(outputDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await client?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      await rm(outputDir, { recursive: true, force: true });
      throw error;
    }
  }
}

function loopbackMcpEndpoint(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(host) || url.username || url.password
    || url.pathname !== '/mcp' || url.search || url.hash) throw new Error('browser_runtime_endpoint_denied');
  return url;
}

/** Production factory: the loopback endpoint must front the isolated browser-runtime compose stack. */
export class RemotePlaywrightMcpSessionFactory implements BrowserMcpSessionFactory {
  private readonly endpoint: URL;

  constructor(endpoint: string) { this.endpoint = loopbackMcpEndpoint(endpoint); }

  async create(_sessionKey: string): Promise<BrowserMcpSession> {
    const client = new Client({ name: 'workspacex-browser-adapter', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      fetch: async (input, init) => {
        const terminating = init?.method === 'DELETE';
        const response = await fetch(input, { ...init, redirect: 'error',
          ...(terminating ? { signal: AbortSignal.timeout(L.deadlineMs) } : {}),
        });
        // SDK terminateSession treats 405 as success; this runtime requires a
        // real server-side termination acknowledgement instead.
        if (terminating && !response.ok) {
          await response.body?.cancel();
          throw new Error('browser_remote_termination_unconfirmed');
        }
        return response;
      },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 },
    });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      try {
        if (transport.sessionId) await transport.terminateSession();
      } finally {
        await client.close();
      }
    })();
    try {
      await client.connect(transport, { timeout: L.deadlineMs });
      assertUpstreamSchemas((await client.listTools(undefined, { timeout: L.deadlineMs })).tools);
      return {
        outputDir: null,
        async call(name, args, signal) {
          if (!ADAPTER_UPSTREAM_TOOLS.has(name)) throw new Error('browser_tool_not_allowed');
          return await client.callTool({ name, arguments: args }, undefined, { signal, timeout: L.deadlineMs, maxTotalTimeout: L.deadlineMs }) as McpResult;
        },
        close,
      };
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  }
}

interface SessionState {
  readonly mcp: BrowserMcpSession;
  pageRef: string | null;
  generation: number;
  url: string;
  title: string;
  elements: Map<string, { upstreamRef: string; generation: number; name?: string; fillType?: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider' }>;
  tail: Promise<void>;
  expiry: ReturnType<typeof setTimeout>;
}

function deadlineError(): Error { return new Error('browser_action_deadline_exceeded'); }

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw deadlineError();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(deadlineError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function previewRequest(raw: string): { workspacePath: string; viewport: { width: number; height: number } } | null {
  if (!raw.startsWith('https://preview.workspacex.invalid/')) return null;
  if (!/^https:\/\/preview\.workspacex\.invalid\/workspace\/web-artifact\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.html\?viewport=(?:desktop|mobile)$/.test(raw)
    || raw.includes('%')) {
    throw new Error('browser_preview_url_denied');
  }
  const url = new URL(raw);
  const viewport = url.searchParams.get('viewport');
  return {
    workspacePath: url.pathname,
    viewport: viewport === 'mobile'
      ? { width: L.mobileViewportWidth, height: L.mobileViewportHeight }
      : { width: L.viewportWidth, height: L.viewportHeight },
  };
}

function isolatedPreviewHtml(bytes: Buffer): string {
  if (!bytes.length || bytes.length > L.maxPreviewBytes) throw new Error('browser_preview_size_invalid');
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}

function textResult(result: McpResult): string {
  if (result.isError) throw new Error('playwright_mcp_call_failed');
  const content = result.content ?? [];
  const encoded = JSON.stringify(content);
  if (Buffer.byteLength(encoded) > L.maxResponseBytes) throw new Error('playwright_mcp_result_too_large');
  return content.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const text = (item as Record<string, unknown>).text;
    return typeof text === 'string' ? [text] : [];
  }).join('\n');
}

function pageMetadata(text: string, fallback: { url: string; title: string }): { url: string; title: string } {
  const url = text.match(/^- Page URL:\s*(.+)$/m)?.[1]?.trim() ?? fallback.url;
  const title = text.match(/^- Page Title:\s*(.*)$/m)?.[1]?.trim() ?? fallback.title;
  new URL(url);
  return { url, title };
}

function snapshotBody(text: string): string {
  const marker = text.indexOf('### Snapshot');
  const body = marker >= 0 ? text.slice(marker + '### Snapshot'.length).trim() : text.trim();
  if (!body || body.length > L.maxSnapshotChars) throw new Error('browser_snapshot_invalid');
  return body;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a'
    || Buffer.from(bytes.subarray(12, 16)).toString('ascii') !== 'IHDR') throw new Error('browser_screenshot_invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (!width || !height) throw new Error('browser_screenshot_invalid');
  return { width, height };
}

async function screenshotBytes(result: McpResult, session: BrowserMcpSession, filename: string): Promise<Buffer> {
  const image = (result.content ?? []).find(item => item && typeof item === 'object' && !Array.isArray(item)
    && (item as Record<string, unknown>).type === 'image'
    && (item as Record<string, unknown>).mimeType === 'image/png'
    && typeof (item as Record<string, unknown>).data === 'string') as Record<string, unknown> | undefined;
  if (image) {
    const bytes = Buffer.from(image.data as string, 'base64');
    if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== (image.data as string).replace(/=+$/, '')) {
      throw new Error('browser_screenshot_invalid');
    }
    return bytes;
  }
  if (!session.outputDir) throw new Error('browser_screenshot_missing');
  return readFile(join(session.outputDir, filename));
}

export class PlaywrightMcpBrowserAdapter implements StandardBrowserService {
  private readonly states = new Map<string, Promise<SessionState>>();

  constructor(
    private readonly owner: NativeSessionOwner,
    private readonly workspaces: (bound: NativeResolved) => BrowserWorkspace,
    private readonly authority: Pick<ToolExecutionAuthority, 'check'>,
    private readonly receipts: BrowserExecutionReceipts,
    private readonly network: BrowserNetworkPolicy,
    private readonly factory: BrowserMcpSessionFactory,
    private readonly deadlineSignal: () => AbortSignal = () => AbortSignal.timeout(L.deadlineMs),
  ) {}

  private async state(bindingId: string, expiresAt: number): Promise<SessionState> {
    let pending = this.states.get(bindingId);
    if (!pending) {
      pending = this.factory.create(sha256(bindingId)).then(mcp => {
        const expiry = setTimeout(() => { void this.release(bindingId).catch(() => undefined); }, Math.max(0, expiresAt - Date.now()));
        expiry.unref();
        return { mcp, pageRef: null, generation: 0, url: 'about:blank', title: '', elements: new Map(), tail: Promise.resolve(), expiry };
      });
      this.states.set(bindingId, pending);
      pending.catch(() => this.states.delete(bindingId));
    }
    return await pending;
  }

  private rotate(state: SessionState, metadata: { url: string; title: string }): void {
    state.generation += 1;
    state.pageRef = opaque('page');
    state.url = metadata.url;
    state.title = metadata.title;
    state.elements.clear();
  }

  private page(state: SessionState, pageRef: string): void {
    if (!state.pageRef || state.pageRef !== pageRef) throw new Error('browser_page_ref_stale_or_foreign');
  }

  private element(state: SessionState, elementRef: string): { upstreamRef: string; name?: string; fillType?: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider' } {
    const found = state.elements.get(elementRef);
    if (!found || found.generation !== state.generation) throw new Error('browser_element_ref_stale_or_foreign');
    return found;
  }

  private async snapshot(state: SessionState, signal: AbortSignal): Promise<{ text: string; metadata: { url: string; title: string } }> {
    const text = textResult(await state.mcp.call('browser_snapshot', {}, signal));
    return { text: snapshotBody(text), metadata: pageMetadata(text, state) };
  }

  private async serial<T>(state: SessionState, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    const run = state.tail.then(async () => {
      if (signal.aborted) throw deadlineError();
      return await action();
    });
    state.tail = run.then(() => undefined, () => undefined);
    return await abortable(run, signal);
  }

  async invoke(context: BrowserContext, invocation: BrowserInvocation): Promise<BrowserInvocationOutput> {
    const deadlineAt = new Date(Date.now() + L.deadlineMs);
    const signal = this.deadlineSignal();
    const parsed = invocation.toolName === 'browser_navigate' ? BrowserNavigateInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_snapshot' ? BrowserSnapshotInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_click' ? BrowserClickInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_fill_form' ? BrowserFillFormInput.parse(invocation.toolArgs)
      : BrowserTakeScreenshotInput.parse(invocation.toolArgs);
    const validated = { toolName: invocation.toolName, toolArgs: parsed } as BrowserInvocation;
    const argsDigest = mcpExecutionDigest(parsed);
    const authorize = async () => {
      const decision = await abortable(this.authority.check({ ...context, toolName: invocation.toolName, toolArgs: parsed }), signal);
      if (!decision.allowed) throw new Error('browser_tool_denied');
    };
    const resolveOwner = () => abortable(this.owner.resolve(context.bindingId, context), signal);
    const initialDecision = await abortable(this.authority.check({ ...context, toolName: invocation.toolName, toolArgs: parsed }), signal);
    if (!initialDecision.allowed) {
      if (['cancel_requested', 'lease_lost', 'run_unavailable', 'attempt_stale'].includes(initialDecision.reason)) void this.release(context.bindingId).catch(() => undefined);
      throw new Error('browser_tool_denied');
    }
    const bound = await resolveOwner();
    const claim = await abortable(this.receipts.claim(context, validated, argsDigest, deadlineAt), signal);
    if (claim.kind === 'unconfirmed') {
      void this.release(context.bindingId).catch(() => undefined);
      throw new Error('browser_execution_unconfirmed_no_replay');
    }
    if (claim.kind === 'succeeded') return claim.result;
    try {
      const state = await abortable(this.state(context.bindingId, bound.expiresAt), signal);
      const postcheck = async () => { await authorize(); await resolveOwner(); };
      const result = await this.serial(state, signal, async () => {
      await authorize();
      await resolveOwner();
      if (invocation.toolName === 'browser_navigate') {
        const input = parsed as z.infer<typeof BrowserNavigateInput>;
        const preview = previewRequest(input.url);
        if (preview) {
          const workspace = this.workspaces(bound);
          const file = schemas.file.parse(await abortable(workspace.read(preview.workspacePath), signal));
          if (file.path !== preview.workspacePath) throw new Error('browser_preview_readback_failed');
          const bytes = Buffer.from(file.contentBase64, 'base64');
          if (file.sizeBytes !== bytes.length || file.contentBase64 !== bytes.toString('base64')) throw new Error('browser_preview_readback_failed');
          const html = isolatedPreviewHtml(bytes);
          await state.mcp.call('browser_resize', preview.viewport, signal).then(textResult);
          await postcheck();
          await state.mcp.call('browser_route', { pattern: input.url, status: 200, body: html, contentType: 'text/html; charset=utf-8' }, signal).then(textResult);
          await postcheck();
        } else {
          await abortable(this.network.assertAllowed(input.url), signal);
          await state.mcp.call('browser_resize', { width: L.viewportWidth, height: L.viewportHeight }, signal).then(textResult);
          await postcheck();
        }
        await state.mcp.call('browser_navigate', { url: input.url }, signal).then(textResult);
        await postcheck();
        const snapshot = await this.snapshot(state, signal);
        await postcheck();
        if (preview) {
          await state.mcp.call('browser_unroute', { pattern: input.url }, signal).then(textResult);
          await postcheck();
        }
        this.rotate(state, snapshot.metadata);
        return BrowserNavigateOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation });
      }
      if (invocation.toolName === 'browser_snapshot') {
        const input = parsed as z.infer<typeof BrowserSnapshotInput>;
        this.page(state, input.pageRef);
        const snapshot = await this.snapshot(state, signal);
        await postcheck();
        state.url = snapshot.metadata.url; state.title = snapshot.metadata.title; state.elements.clear();
        const upstream = [...snapshot.text.matchAll(/\bref=([A-Za-z0-9_-]{1,256})\b/g)].map(match => match[1] as string);
        const unique = [...new Set(upstream)].slice(0, L.maxElements);
        const replacements = new Map<string, string>();
        const elements = unique.map(upstreamRef => {
          const elementRef = opaque('element');
          const escaped = upstreamRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const line = snapshot.text.split('\n').find(candidate => new RegExp(`\\bref=${escaped}\\b`).test(candidate)) ?? '';
          const metadata = line.match(/-\s+(textbox|checkbox|radio|combobox|slider|button|link)(?:\s+"([^"]*)")?/);
          const role = metadata?.[1];
          const fillType = role && ['textbox', 'checkbox', 'radio', 'combobox', 'slider'].includes(role)
            ? role as 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider'
            : undefined;
          state.elements.set(elementRef, { upstreamRef, generation: state.generation, ...(metadata?.[2] ? { name: metadata[2] } : {}), ...(fillType ? { fillType } : {}) });
          replacements.set(upstreamRef, elementRef);
          return { elementRef };
        });
        const redactedSnapshot = snapshot.text.replace(/\bref=([A-Za-z0-9_-]{1,256})\b/g, (match, upstreamRef: string) => {
          const elementRef = replacements.get(upstreamRef);
          return elementRef ? `ref=${elementRef}` : match;
        });
        return BrowserSnapshotOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation, snapshot: redactedSnapshot, elements });
      }
      if (invocation.toolName === 'browser_click') {
        const input = parsed as z.infer<typeof BrowserClickInput>;
        this.page(state, input.pageRef);
        const element = this.element(state, input.elementRef);
        await state.mcp.call('browser_click', { target: element.upstreamRef, element: element.name ?? 'authorized element' }, signal).then(textResult);
        await postcheck();
        const snapshot = await this.snapshot(state, signal);
        await postcheck();
        this.rotate(state, snapshot.metadata);
        return BrowserClickOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation, outcome: 'clicked' });
      }
      if (invocation.toolName === 'browser_fill_form') {
        const input = parsed as z.infer<typeof BrowserFillFormInput>;
        this.page(state, input.pageRef);
        const fields = input.fields.map(field => {
          const element = this.element(state, field.ref);
          if (!element.fillType) throw new Error('browser_element_not_fillable');
          return { target: element.upstreamRef, name: element.name ?? 'authorized field', type: element.fillType, value: String(field.value) };
        });
        await state.mcp.call('browser_fill_form', { fields }, signal).then(textResult);
        await postcheck();
        const snapshot = await this.snapshot(state, signal);
        await postcheck();
        this.rotate(state, snapshot.metadata);
        return BrowserFillFormOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation, filled: input.fields.map(field => field.ref) });
      }
      const input = parsed as z.infer<typeof BrowserTakeScreenshotInput>;
      this.page(state, input.pageRef);
      const filename = `screenshot-${randomBytes(32).toString('hex')}.png`;
      const upstreamFilename = state.mcp.outputDir ? join(state.mcp.outputDir, filename) : undefined;
      const upstream = await state.mcp.call('browser_take_screenshot', {
        ...(upstreamFilename ? { filename: upstreamFilename } : {}), type: 'png', fullPage: input.fullPage ?? false, scale: 'css',
      }, signal);
      textResult(upstream);
      await postcheck();
      const bytes = await screenshotBytes(upstream, state.mcp, filename);
      const dimensions = pngDimensions(bytes);
      const workspacePath = `/workspace/browser-${sha256(`${context.bindingId}:${filename}`)}.png`;
      const workspace = this.workspaces(bound);
      await abortable(workspace.write({ path: workspacePath, contentBase64: bytes.toString('base64') }), signal);
      const readback = schemas.file.parse(await abortable(workspace.read(workspacePath), signal));
      if (readback.path !== workspacePath || readback.sizeBytes !== bytes.length || readback.contentBase64 !== bytes.toString('base64')) throw new Error('browser_screenshot_readback_failed');
      await postcheck();
      return BrowserScreenshotOutput.parse({ pageRef: state.pageRef, workspacePath, mime: 'image/png', ...dimensions, sha256: sha256(bytes), sizeBytes: bytes.length, fullPage: input.fullPage ?? false });
      });
      await postcheck();
      await abortable(this.receipts.succeed(context, validated, argsDigest, result), signal);
      return result;
    } catch {
      if (signal.aborted) void this.receipts.markUnconfirmed(context, validated, argsDigest).catch(() => undefined);
      else await abortable(this.receipts.markUnconfirmed(context, validated, argsDigest), signal).catch(() => undefined);
      void this.release(context.bindingId).catch(() => undefined);
      throw new Error('browser_execution_unconfirmed_no_replay');
    }
  }

  async release(bindingId: string): Promise<void> {
    const pending = this.states.get(bindingId);
    this.states.delete(bindingId);
    if (!pending) return;
    const state = await pending.catch(() => null);
    if (state) {
      clearTimeout(state.expiry);
      await state.tail;
      await state.mcp.close();
    }
  }
}
