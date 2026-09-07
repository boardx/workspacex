import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
  BrowserInvocation,
  BrowserInvocationOutput,
  BrowserWorkspace,
  StandardBrowserService,
} from '../../application/agent-run/standard-browser-tools';
import type { NativeResolved, NativeSessionOwner } from '../../application/agent-run/native-session-owner';
import type { ToolExecutionAuthority } from '../../application/agent-run/tool-execution-authority';

const REQUIRED_TOOLS = new Set(['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill_form', 'browser_take_screenshot']);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const opaque = (kind: 'page' | 'element') => `${kind}:${randomBytes(32).toString('hex')}`;

export interface BrowserNetworkPolicy {
  assertAllowed(url: string): Promise<void>;
}

function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19));
}

function privateIp(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0] ?? '';
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

export class PublicBrowserNetworkPolicy implements BrowserNetworkPolicy {
  async assertAllowed(raw: string): Promise<void> {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname === 'localhost') {
      throw new Error('browser_network_denied');
    }
    const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
    const literalKind = isIP(hostname);
    const addresses = literalKind ? [hostname] : (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address);
    if (!addresses.length || addresses.some(privateIp)) throw new Error('browser_network_denied');
  }
}

interface McpResult {
  content?: unknown[];
  isError?: boolean;
}

interface BrowserMcpSession {
  readonly outputDir: string;
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
  const screenshot = properties(byName.get('browser_take_screenshot'));
  if (!['filename', 'type', 'fullPage', 'scale'].every(key => Object.hasOwn(screenshot, key))) throw new Error('playwright_mcp_contract_changed');
}

export interface BrowserMcpSessionFactory {
  create(sessionKey: string): Promise<BrowserMcpSession>;
}

export class OfficialPlaywrightMcpSessionFactory implements BrowserMcpSessionFactory {
  constructor(private readonly network: BrowserNetworkPolicy = new PublicBrowserNetworkPolicy()) {}

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
        capabilities: ['core'],
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
          if (!REQUIRED_TOOLS.has(name)) throw new Error('browser_tool_not_allowed');
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

export class PlaywrightMcpBrowserAdapter implements StandardBrowserService {
  private readonly states = new Map<string, Promise<SessionState>>();

  constructor(
    private readonly owner: NativeSessionOwner,
    private readonly workspaces: (bound: NativeResolved) => BrowserWorkspace,
    private readonly authority: Pick<ToolExecutionAuthority, 'check'>,
    private readonly factory: BrowserMcpSessionFactory = new OfficialPlaywrightMcpSessionFactory(),
  ) {}

  private async state(bindingId: string, expiresAt: number): Promise<SessionState> {
    let pending = this.states.get(bindingId);
    if (!pending) {
      pending = this.factory.create(sha256(bindingId)).then(mcp => {
        const expiry = setTimeout(() => { void this.release(bindingId); }, Math.max(0, expiresAt - Date.now()));
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

  private async serial<T>(state: SessionState, action: () => Promise<T>): Promise<T> {
    const previous = state.tail;
    let unlock!: () => void;
    state.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try { return await action(); } finally { unlock(); }
  }

  async invoke(context: BrowserContext, invocation: BrowserInvocation): Promise<BrowserInvocationOutput> {
    const parsed = invocation.toolName === 'browser_navigate' ? BrowserNavigateInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_snapshot' ? BrowserSnapshotInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_click' ? BrowserClickInput.parse(invocation.toolArgs)
      : invocation.toolName === 'browser_fill_form' ? BrowserFillFormInput.parse(invocation.toolArgs)
      : BrowserTakeScreenshotInput.parse(invocation.toolArgs);
    const authorize = async () => {
      const decision = await this.authority.check({ ...context, toolName: invocation.toolName, toolArgs: parsed });
      if (!decision.allowed) throw new Error('browser_tool_denied');
    };
    const initialDecision = await this.authority.check({ ...context, toolName: invocation.toolName, toolArgs: parsed });
    if (!initialDecision.allowed) {
      if (['cancel_requested', 'lease_lost', 'run_unavailable', 'attempt_stale'].includes(initialDecision.reason)) await this.release(context.bindingId);
      throw new Error('browser_tool_denied');
    }
    const bound = await this.owner.resolve(context.bindingId, context);
    const state = await this.state(context.bindingId, bound.expiresAt);
    return await this.serial(state, async () => {
      const signal = AbortSignal.timeout(L.deadlineMs);
      await authorize();
      await this.owner.resolve(context.bindingId, context);
      if (invocation.toolName === 'browser_navigate') {
        const input = parsed as z.infer<typeof BrowserNavigateInput>;
        await state.mcp.call('browser_navigate', { url: input.url }, signal).then(textResult);
        const snapshot = await this.snapshot(state, signal);
        this.rotate(state, snapshot.metadata);
        return BrowserNavigateOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation });
      }
      if (invocation.toolName === 'browser_snapshot') {
        const input = parsed as z.infer<typeof BrowserSnapshotInput>;
        this.page(state, input.pageRef);
        const snapshot = await this.snapshot(state, signal);
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
        const snapshot = await this.snapshot(state, signal);
        this.rotate(state, snapshot.metadata);
        return BrowserClickOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation, outcome: 'clicked' });
      }
      if (invocation.toolName === 'browser_fill_form') {
        const input = parsed as z.infer<typeof BrowserFillFormInput>;
        this.page(state, input.pageRef);
        const fields = input.fields.map(field => {
          const element = this.element(state, field.ref);
          if (!element.fillType) throw new Error('browser_element_not_fillable');
          return { target: element.upstreamRef, name: element.name ?? 'authorized field', type: element.fillType, value: field.value };
        });
        await state.mcp.call('browser_fill_form', { fields }, signal).then(textResult);
        const snapshot = await this.snapshot(state, signal);
        this.rotate(state, snapshot.metadata);
        return BrowserFillFormOutput.parse({ pageRef: state.pageRef, ...snapshot.metadata, generation: state.generation, filled: input.fields.map(field => field.ref) });
      }
      const input = parsed as z.infer<typeof BrowserTakeScreenshotInput>;
      this.page(state, input.pageRef);
      const filename = `screenshot-${randomBytes(32).toString('hex')}.png`;
      await state.mcp.call('browser_take_screenshot', { filename, type: 'png', fullPage: input.fullPage ?? false, scale: 'css' }, signal).then(textResult);
      const bytes = await readFile(join(state.mcp.outputDir, filename));
      const dimensions = pngDimensions(bytes);
      const workspacePath = `/workspace/browser-${sha256(`${context.bindingId}:${filename}`)}.png`;
      const workspace = this.workspaces(bound);
      await workspace.write({ path: workspacePath, contentBase64: bytes.toString('base64') });
      const readback = schemas.file.parse(await workspace.read(workspacePath));
      if (readback.path !== workspacePath || readback.sizeBytes !== bytes.length || readback.contentBase64 !== bytes.toString('base64')) throw new Error('browser_screenshot_readback_failed');
      await authorize(); await this.owner.resolve(context.bindingId, context);
      return BrowserScreenshotOutput.parse({ pageRef: state.pageRef, workspacePath, mime: 'image/png', ...dimensions, sha256: sha256(bytes), sizeBytes: bytes.length, fullPage: input.fullPage ?? false });
    });
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
