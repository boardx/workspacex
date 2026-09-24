import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { readObjects, WhiteboardObject } from '@repo/whiteboard-core';
import { whiteboardSync } from '@repo/contracts';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { analyzeSoak, canonicalizeDocument, documentHash, readSoakConfig, reportStatus, soakEnvironmentFingerprint, writeSoakReport, type SoakClientResult, type SoakOperation, type SoakParticipant, type SoakReceipt, type SoakReconnect, type SoakReport, type SoakServerLedger } from './support/whiteboard-collaboration-soak';

const config = readSoakConfig();
const reportPath = process.env.WHITEBOARD_SOAK_REPORT ?? 'test-results/whiteboard-collaboration-soak/report.json';
const operationPrefix = 'soak-4144:';
const fallback: Record<string, string | undefined> = {
  WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail,
  WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
  WHITEBOARD_OWNER_USER_ID: FULLSTACK_E2E.adminUserId,
  WHITEBOARD_EDITOR_EMAIL: FULLSTACK_E2E.leadEmail,
  WHITEBOARD_EDITOR_PASSWORD: FULLSTACK_E2E.leadPassword,
  WHITEBOARD_EDITOR_USER_ID: FULLSTACK_E2E.leadUserId,
  WHITEBOARD_VIEWER_EMAIL: FULLSTACK_E2E.email,
  WHITEBOARD_VIEWER_PASSWORD: FULLSTACK_E2E.password,
  WHITEBOARD_VIEWER_USER_ID: FULLSTACK_E2E.userId,
  WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined,
};

function required(name: string): string {
  const value = process.env[name] ?? fallback[name];
  if (!value) throw new Error(`Missing Board soak fixture: ${name}`);
  return value;
}

async function login(page: Page, actor: 'OWNER' | 'EDITOR' | 'VIEWER'): Promise<string> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(required(`WHITEBOARD_${actor}_EMAIL`));
  await page.getByTestId('login-password').fill(required(`WHITEBOARD_${actor}_PASSWORD`));
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 30_000 });
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  if (!token) throw new Error(`${actor} login did not issue a session token`);
  return token;
}

async function loginToken(browser: Browser, baseURL: string | undefined, actor: 'OWNER' | 'EDITOR' | 'VIEWER'): Promise<string> {
  const context = await browser.newContext({ baseURL });
  try { return await login(await context.newPage(), actor); }
  finally { await context.close(); }
}

async function apiRequest(api: APIRequestContext, token: string, method: string, route: string, data?: unknown) {
  const response = await api.fetch(`${required('WHITEBOARD_API_URL').replace(/\/$/, '')}${route}`, {
    method, headers: { Authorization: `Bearer ${token}` }, data,
  });
  if (!response.ok()) throw new Error(`${method} ${route} returned ${response.status()}: ${await response.text()}`);
  return response;
}

type SoakRunRequest = {runId:string;exactSha:string;environmentFingerprint:string;purpose:'initial'|'fresh'|'server';requiredDurationMs:number;expectedClients:number;expectedWriters:number};
async function authenticatedContext(browser: Browser, baseURL: string | undefined, token: string, soakRun: SoakRunRequest): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(({ key, value, run }) => { localStorage.setItem(key, value); sessionStorage.setItem('__WORKSPACEX_WHITEBOARD_SOAK__', '1'); sessionStorage.setItem('__WORKSPACEX_WHITEBOARD_SOAK_RUN__', JSON.stringify(run)); }, { key: SESSION_TOKEN_STORAGE_KEY, value: token, run: soakRun });
  return context;
}

async function waitSynced(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId('collaborative-editor')).toBeVisible({ timeout });
  await expect(page.getByText(/^已同步(?: · 只读)?$/)).toBeVisible({ timeout });
}

async function operationIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="whiteboard-object-"]').evaluateAll((nodes, prefix) => nodes
    .map(node => node.getAttribute('aria-label') ?? '')
    .filter(label => label.startsWith(`图形：${prefix}`))
    .map(label => label.slice('图形：'.length)), operationPrefix);
}

type RuntimeBinding = { clientNonce: string; connectionId: string; role: 'owner' | 'editor' | 'viewer'; runId:string; challenge:string;seq:number };
async function runtimeEvidence(page: Page): Promise<{ objects: unknown[]; binding: RuntimeBinding }> {
  return page.evaluate(() => {
    const diagnostics = window as typeof window & { __WORKSPACEX_WHITEBOARD_DOCUMENT__?: () => { objects: unknown[]; binding: { clientNonce: string; connectionId: string | null; role: 'owner' | 'editor' | 'viewer'; runId:string|null; challenge:string|null;seq:number } } };
    if (!diagnostics.__WORKSPACEX_WHITEBOARD_DOCUMENT__) throw new Error('whiteboard document diagnostics are unavailable');
    const evidence = diagnostics.__WORKSPACEX_WHITEBOARD_DOCUMENT__();
    if (!evidence.binding.clientNonce || !evidence.binding.connectionId || !evidence.binding.runId || !evidence.binding.challenge) throw new Error('whiteboard server binding is unavailable');
    return { objects: evidence.objects, binding: { ...evidence.binding, connectionId: evidence.binding.connectionId, runId:evidence.binding.runId, challenge:evidence.binding.challenge } };
  });
}
async function runtimeBinding(page: Page): Promise<RuntimeBinding> { return (await runtimeEvidence(page)).binding; }

async function clientResult(page: Page, expected: number): Promise<SoakClientResult> {
  await expect.poll(() => operationIds(page), { timeout: 30_000, message: `browser client must converge to ${expected} operations` })
    .toHaveLength(expected);
  const raw = await runtimeEvidence(page), document = canonicalizeDocument(WhiteboardObject.array().parse(raw.objects));
  return { client: raw.binding.clientNonce, connectionId: raw.binding.connectionId, role: raw.binding.role,seq:raw.binding.seq,document, hash: documentHash(document) };
}

async function createOperation(page: Page, id: string): Promise<void> {
  await page.getByTestId('board-add-sticky').click();
  await page.getByLabel('对象文字', { exact: true }).fill(id);
  await waitSynced(page, 15_000);
}

async function observeAllClients(pages: readonly Page[], id: string): Promise<SoakReceipt[]> {
  return Promise.all(pages.map(async page => {
    await page.getByRole('button', { name: `图形：${id}`, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    const binding = await runtimeBinding(page);
    return { client: binding.clientNonce, connectionId: binding.connectionId, role: binding.role, visibleAtMs: Date.now() };
  }));
}

async function serverResult(boardId: string, token: string, soakRun: SoakRunRequest, challenge: string): Promise<{result:SoakClientResult;ledger:SoakServerLedger}> {
  const doc = new Y.Doc();
  const clientNonce = randomUUID();
  const apiUrl = new URL(required('WHITEBOARD_API_URL'));
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.pathname = whiteboardSync.WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(boardId));
  const socket = new WebSocket(apiUrl, [whiteboardSync.WHITEBOARD_SYNC.protocol, `${whiteboardSync.WHITEBOARD_SYNC.bearerSubprotocolPrefix}${token}`]);
  try {
    const evidence = await new Promise<{binding:RuntimeBinding;ledger:SoakServerLedger}>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server snapshot WebSocket timed out')), 15_000);
      let binding:RuntimeBinding|null=null;
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', stateVector: Buffer.from(Y.encodeStateVector(doc)).toString('base64'), clientNonce, soakRun })));
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('server snapshot WebSocket failed')); });
      socket.addEventListener('message', event => {
        const parsed = whiteboardSync.WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (parsed.type === 'error') { clearTimeout(timer); reject(new Error(`server snapshot rejected: ${parsed.code}`)); return; }
        if (parsed.type === 'sync') {
          if (!parsed.clientNonce || !parsed.connectionId || !parsed.soakBinding || parsed.soakBinding.runId!==soakRun.runId || parsed.soakBinding.challenge!==challenge) { clearTimeout(timer); reject(new Error('server snapshot did not receive the expected server-bound run identity')); return; }
          binding={clientNonce:parsed.clientNonce,connectionId:parsed.connectionId,role:parsed.role,runId:parsed.soakBinding.runId,challenge:parsed.soakBinding.challenge,seq:parsed.seq};
          Y.applyUpdate(doc, new Uint8Array(Buffer.from(parsed.update, 'base64'))); socket.send(JSON.stringify({type:'soak-finish',runId:soakRun.runId,challenge})); return;
        }
        if(parsed.type==='soak-ledger'&&binding){clearTimeout(timer);resolve({binding,ledger:{payload:parsed.payload,signature:parsed.signature}});}
      });
    });
    const document = canonicalizeDocument(readObjects(doc));
    return { result:{ client: evidence.binding.clientNonce, connectionId: evidence.binding.connectionId, role: evidence.binding.role,seq:evidence.binding.seq,document, hash: documentHash(document) },ledger:evidence.ledger };
  } finally { socket.close(); doc.destroy(); }
}

test.describe.configure({ mode: 'serial' });
test('50 independent browser contexts converge without loss, duplicates or forks', async ({ browser, request, baseURL }) => {
  test.setTimeout(config.durationMs + config.offlineMs + 10 * 60_000);
  const startedAt = new Date();
  const exactSha = (process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toLowerCase();
  const runId=randomUUID();
  if (!/^[a-f0-9]{40}$/.test(exactSha)) throw new Error('soak evidence requires an exact 40-character SHA');
  const operations: SoakOperation[] = [], reconnects: SoakReconnect[] = [], clientResults: SoakClientResult[] = [];
  const initialClients: SoakParticipant[] = [];
  const contexts: BrowserContext[] = [], pages: Page[] = [];
  let freshClient: SoakClientResult | null = null, server: SoakClientResult | null = null;
  let serverLedger: SoakServerLedger | null = null;
  let boardId: string | null = null, ownerToken: string | null = null, viewerToken: string | null = null, failure: string | null = null;
  let collaborationStartedAt: Date | null = null, collaborationFinishedAt: Date | null = null, collaborationDurationMs = 0;
  let browserVersion = 'unknown';
  try {
    browserVersion = browser.version();
    const environment={ os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, browser: browserVersion, ci: process.env.CI === 'true' };
    const runBase={runId,exactSha,environmentFingerprint:soakEnvironmentFingerprint(environment),requiredDurationMs:config.durationMs,expectedClients:config.clients,expectedWriters:config.writers};
    ownerToken = await loginToken(browser, baseURL, 'OWNER');
    const editorToken = await loginToken(browser, baseURL, 'EDITOR');
    viewerToken = await loginToken(browser, baseURL, 'VIEWER');
    const created = await apiRequest(request, ownerToken, 'POST', '/whiteboards', { requestId: randomUUID(), name: `50 browser soak ${exactSha.slice(0, 8)}` });
    boardId = (await created.json() as { id: string }).id;
    await apiRequest(request, ownerToken, 'PUT', `/whiteboards/${boardId}/members`, { userId: required('WHITEBOARD_EDITOR_USER_ID'), role: 'editor' });
    await apiRequest(request, ownerToken, 'PUT', `/whiteboards/${boardId}/members`, { userId: required('WHITEBOARD_VIEWER_USER_ID'), role: 'viewer' });
    for (let index = 0; index < config.clients; index++) {
      const context = await authenticatedContext(browser, baseURL, index < config.writers ? editorToken : viewerToken,{...runBase,purpose:'initial'});
      contexts.push(context); pages.push(await context.newPage());
    }

    await Promise.all(pages.map(async page => { await page.goto(`/studio/board/${boardId}`); await waitSynced(page); }));
    const initialBindings = await Promise.all(pages.map(runtimeBinding));
    const challenge=initialBindings[0]!.challenge;
    if(initialBindings.some(binding=>binding.runId!==runBase.runId||binding.challenge!==challenge))throw new Error('initial browser contexts were not bound to one server run challenge');
    initialClients.push(...initialBindings.map((binding, index) => ({ client: binding.clientNonce, connectionId: binding.connectionId, role: binding.role, writer: index < config.writers })));
    collaborationStartedAt = new Date(); const collaborationStartedMs = collaborationStartedAt.getTime();
    const offlineWriterIndexes = Array.from({ length: Math.min(5, config.writers) }, (_, index) => index);
    const offlineWriters = new Set<number>(); let outage: Promise<void> | null = null;
    const runOutage = async () => {
      for (const index of offlineWriterIndexes) offlineWriters.add(index);
      const offlineAt = new Map<number, number>();
      const previousBindings = new Map<number, RuntimeBinding>();
      await Promise.all(offlineWriterIndexes.map(async index => { previousBindings.set(index, await runtimeBinding(pages[index]!)); }));
      await Promise.all(offlineWriterIndexes.map(async index => { offlineAt.set(index, Date.now()); await contexts[index]!.setOffline(true); }));
      await Promise.all(offlineWriterIndexes.map(index => expect(pages[index]!.getByText(/^连接中断/)).toBeVisible({ timeout: 5_000 })));
      const offlineOperations = await Promise.all(offlineWriterIndexes.map(async index => {
        const id = `${operationPrefix}offline-${index}-${randomUUID()}`, createdAtMs = Date.now();
        const writerBinding = await runtimeBinding(pages[index]!);
        await pages[index]!.getByTestId('board-add-sticky').click();
        await pages[index]!.getByLabel('对象文字', { exact: true }).fill(id);
        const operation: SoakOperation = { id, writer: writerBinding.clientNonce, writerConnectionId: writerBinding.connectionId, createdAtMs, disruption: true, receipts: [] };
        operations.push(operation);
        return { id, index, operation };
      }));
      await new Promise(resolve => setTimeout(resolve, config.offlineMs));
      const observer = pages[config.writers]!;
      await Promise.all(offlineOperations.map(async ({ id, index }) => {
        const onlineAt = Date.now(); await contexts[index]!.setOffline(false);
        let recoveredAtMs: number | null = null;
        try { await observer.getByRole('button', { name: `图形：${id}`, exact: true }).waitFor({ state: 'visible', timeout: config.reconnectMs }); recoveredAtMs = Date.now(); }
        catch { recoveredAtMs = null; }
        const rebound = await runtimeBinding(pages[index]!); const previous = previousBindings.get(index)!;
        reconnects.push({ client: rebound.clientNonce, previousConnectionId: previous.connectionId, connectionId: rebound.connectionId, offlineAtMs: offlineAt.get(index)!, onlineAtMs: onlineAt, recoveredAtMs, elapsedMs: (recoveredAtMs ?? Date.now()) - onlineAt, recovered: recoveredAtMs !== null });
        offlineWriters.delete(index);
      }));
      await Promise.all(offlineOperations.map(async ({ id, operation }) => { operation.receipts = await observeAllClients(pages, id); }));
    };

    // One extra operation interval guarantees the last server-committed update,
    // rather than a caller clock scalar, spans the complete required duration.
    const endAt = collaborationStartedMs + config.durationMs + config.operationIntervalMs, outageAt = collaborationStartedMs + Math.floor(config.durationMs / 2);
    let cursor = 0;
    while (Date.now() < endAt) {
      if (!outage && Date.now() >= outageAt) outage = runOutage();
      let writer = cursor++ % config.writers;
      while (offlineWriters.has(writer)) writer = cursor++ % config.writers;
      const id = `${operationPrefix}${writer}-${randomUUID()}`, createdAtMs = Date.now();
      const writerBinding = await runtimeBinding(pages[writer]!);
      await createOperation(pages[writer]!, id);
      const receipts = await observeAllClients(pages, id);
      operations.push({ id, writer: writerBinding.clientNonce, writerConnectionId: writerBinding.connectionId, createdAtMs, disruption: false, receipts });
      const remaining = config.operationIntervalMs - (Date.now() - createdAtMs);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }
    if (!outage) outage = runOutage(); await outage;
    collaborationFinishedAt = new Date(); collaborationDurationMs = collaborationFinishedAt.getTime() - collaborationStartedMs;

    await Promise.all(pages.map(page => waitSynced(page, 30_000)));
    clientResults.push(...await Promise.all(pages.map(page => clientResult(page, operations.length))));
    const replaced = config.clients - 1; await contexts[replaced]!.close(); contexts.splice(replaced, 1); pages.splice(replaced, 1);
    if (!viewerToken) throw new Error('viewer token missing before fresh-client verification');
    const freshContext = await authenticatedContext(browser, baseURL, viewerToken,{...runBase,purpose:'fresh'});
    contexts.push(freshContext); const freshPage = await freshContext.newPage(); pages.push(freshPage);
    await freshPage.goto(`/studio/board/${boardId}`); await waitSynced(freshPage); freshClient = await clientResult(freshPage, operations.length);
    await Promise.all(contexts.map(context => context.close())); contexts.length = 0; pages.length = 0;
    const signed=await serverResult(boardId, ownerToken,{...runBase,purpose:'server'},challenge);server=signed.result;serverLedger=signed.ledger;
    const provisionalFinishedAt = new Date();
    const analysis = analyzeSoak({ runId,exactSha,environment,startedAt: startedAt.toISOString(), finishedAt: provisionalFinishedAt.toISOString(), collaborationStartedAt: collaborationStartedAt.toISOString(), collaborationFinishedAt: collaborationFinishedAt.toISOString(), collaborationDurationMs, initialClients, operations, clients: clientResults, freshClient, server, reconnects, serverLedger,config });
    const status = reportStatus(config, analysis, null);
    if (status !== (config.profile === 'acceptance' ? 'accepted' : 'diagnostic-passed')) throw new Error(`soak verdict ${status}: ${JSON.stringify(analysis)}`);
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    if (boardId && ownerToken) await apiRequest(request, ownerToken, 'PATCH', `/whiteboards/${boardId}`, { archived: true }).catch(() => undefined);
    const finishedAt = new Date(); collaborationDurationMs = collaborationStartedAt && collaborationFinishedAt ? collaborationFinishedAt.getTime() - collaborationStartedAt.getTime() : 0;
    const environment={ os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, browser: browserVersion, ci: process.env.CI === 'true' };
    const evidence = { runId,exactSha,environment,startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), collaborationStartedAt: collaborationStartedAt?.toISOString() ?? null, collaborationFinishedAt: collaborationFinishedAt?.toISOString() ?? null, collaborationDurationMs, initialClients, operations, clients: clientResults, freshClient, server, reconnects,serverLedger,config };
    const analysis = analyzeSoak(evidence);
    const report: SoakReport = { schemaVersion: 3, issue: 4144, status: reportStatus(config, analysis, failure), ...evidence,
      analysis, failure };
    await writeSoakReport(reportPath, report);
  }
});
