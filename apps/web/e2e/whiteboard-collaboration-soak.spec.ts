import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { readObjects } from '@repo/whiteboard-core';
import { whiteboardSync } from '@repo/contracts';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { analyzeSoak, operationHash, readSoakConfig, reportStatus, writeSoakReport, type SoakClientResult, type SoakOperation, type SoakReconnect, type SoakReport } from './support/whiteboard-collaboration-soak';

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

async function authenticatedContext(browser: Browser, baseURL: string | undefined, token: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: SESSION_TOKEN_STORAGE_KEY, value: token });
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

async function clientResult(client: string, page: Page, expected: number): Promise<SoakClientResult> {
  await expect.poll(() => operationIds(page), { timeout: 30_000, message: `${client} must converge to ${expected} operations` })
    .toHaveLength(expected);
  const ids = await operationIds(page);
  return { client, operationIds: ids, hash: operationHash(ids) };
}

async function createOperation(page: Page, id: string): Promise<void> {
  await page.getByTestId('board-add-sticky').click();
  await page.getByLabel('对象文字', { exact: true }).fill(id);
  await waitSynced(page, 15_000);
}

async function serverResult(boardId: string, token: string): Promise<SoakClientResult> {
  const doc = new Y.Doc();
  const apiUrl = new URL(required('WHITEBOARD_API_URL'));
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.pathname = whiteboardSync.WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(boardId));
  const socket = new WebSocket(apiUrl, [whiteboardSync.WHITEBOARD_SYNC.protocol, `${whiteboardSync.WHITEBOARD_SYNC.bearerSubprotocolPrefix}${token}`]);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server snapshot WebSocket timed out')), 15_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', stateVector: Buffer.from(Y.encodeStateVector(doc)).toString('base64') })));
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('server snapshot WebSocket failed')); });
      socket.addEventListener('message', event => {
        const parsed = whiteboardSync.WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (parsed.type === 'error') { clearTimeout(timer); reject(new Error(`server snapshot rejected: ${parsed.code}`)); return; }
        if (parsed.type !== 'sync') return;
        clearTimeout(timer); Y.applyUpdate(doc, new Uint8Array(Buffer.from(parsed.update, 'base64'))); resolve();
      });
    });
    const ids = readObjects(doc).map(object => object.text).filter(text => text.startsWith(operationPrefix));
    return { client: 'server', operationIds: ids, hash: operationHash(ids) };
  } finally { socket.close(); doc.destroy(); }
}

test.describe.configure({ mode: 'serial' });
test('50 independent browser contexts converge without loss, duplicates or forks', async ({ browser, request, baseURL }) => {
  test.setTimeout(config.durationMs + config.offlineMs + 10 * 60_000);
  const startedAt = new Date();
  const exactSha = (process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(exactSha)) throw new Error('soak evidence requires an exact 40-character SHA');
  const operations: SoakOperation[] = [], reconnects: SoakReconnect[] = [], clientResults: SoakClientResult[] = [];
  const contexts: BrowserContext[] = [], pages: Page[] = [];
  let freshClient: SoakClientResult | null = null, server: SoakClientResult | null = null;
  let boardId: string | null = null, ownerToken: string | null = null, viewerToken: string | null = null, failure: string | null = null;
  let collaborationStartedAt: Date | null = null, collaborationDurationMs = 0;
  let browserVersion = 'unknown';
  try {
    browserVersion = browser.version();
    ownerToken = await loginToken(browser, baseURL, 'OWNER');
    const editorToken = await loginToken(browser, baseURL, 'EDITOR');
    viewerToken = await loginToken(browser, baseURL, 'VIEWER');
    const created = await apiRequest(request, ownerToken, 'POST', '/whiteboards', { requestId: randomUUID(), name: `50 browser soak ${exactSha.slice(0, 8)}` });
    boardId = (await created.json() as { id: string }).id;
    await apiRequest(request, ownerToken, 'PUT', `/whiteboards/${boardId}/members`, { userId: required('WHITEBOARD_EDITOR_USER_ID'), role: 'editor' });
    await apiRequest(request, ownerToken, 'PUT', `/whiteboards/${boardId}/members`, { userId: required('WHITEBOARD_VIEWER_USER_ID'), role: 'viewer' });
    for (let index = 0; index < config.clients; index++) {
      const context = await authenticatedContext(browser, baseURL, index < config.writers ? editorToken : viewerToken);
      contexts.push(context); pages.push(await context.newPage());
    }

    await Promise.all(pages.map(async page => { await page.goto(`/studio/board/${boardId}`); await waitSynced(page); }));
    collaborationStartedAt = new Date(); const collaborationStartedMs = collaborationStartedAt.getTime();
    const offlineWriterIndexes = Array.from({ length: Math.min(5, config.writers) }, (_, index) => index);
    const offlineWriters = new Set<number>(); let outage: Promise<void> | null = null;
    const runOutage = async () => {
      for (const index of offlineWriterIndexes) offlineWriters.add(index);
      await Promise.all(offlineWriterIndexes.map(index => contexts[index]!.setOffline(true)));
      await Promise.all(offlineWriterIndexes.map(index => expect(pages[index]!.getByText(/^连接中断/)).toBeVisible({ timeout: 5_000 })));
      const offlineOperations = await Promise.all(offlineWriterIndexes.map(async index => {
        const id = `${operationPrefix}offline-${index}-${randomUUID()}`, createdAtMs = Date.now();
        await pages[index]!.getByTestId('board-add-sticky').click();
        await pages[index]!.getByLabel('对象文字', { exact: true }).fill(id);
        operations.push({ id, writer: index, createdAtMs, visibleAtMs: null, disruption: true });
        return { id, index };
      }));
      await new Promise(resolve => setTimeout(resolve, config.offlineMs));
      const observer = pages[config.writers]!;
      await Promise.all(offlineOperations.map(async ({ id, index }) => {
        const onlineAt = Date.now(); await contexts[index]!.setOffline(false);
        let recovered = true;
        try { await observer.getByRole('button', { name: `图形：${id}`, exact: true }).waitFor({ state: 'visible', timeout: config.reconnectMs }); }
        catch { recovered = false; }
        reconnects.push({ client: String(index), elapsedMs: Date.now() - onlineAt, recovered });
        offlineWriters.delete(index);
      }));
    };

    const endAt = collaborationStartedMs + config.durationMs, outageAt = collaborationStartedMs + Math.floor(config.durationMs / 2);
    let cursor = 0;
    while (Date.now() < endAt) {
      if (!outage && Date.now() >= outageAt) outage = runOutage();
      let writer = cursor++ % config.writers;
      while (offlineWriters.has(writer)) writer = cursor++ % config.writers;
      const id = `${operationPrefix}${writer}-${randomUUID()}`, createdAtMs = Date.now();
      await createOperation(pages[writer]!, id);
      const observer = pages[config.writers + (writer % (config.clients - config.writers))]!;
      await observer.getByRole('button', { name: `图形：${id}`, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      operations.push({ id, writer, createdAtMs, visibleAtMs: Date.now(), disruption: false });
      const remaining = config.operationIntervalMs - (Date.now() - createdAtMs);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    }
    if (!outage) outage = runOutage(); await outage;
    collaborationDurationMs = Date.now() - collaborationStartedMs;

    await Promise.all(pages.map(page => waitSynced(page, 30_000)));
    clientResults.push(...await Promise.all(pages.map((page, index) => clientResult(String(index), page, operations.length))));
    const replaced = config.clients - 1; await contexts[replaced]!.close(); contexts.splice(replaced, 1); pages.splice(replaced, 1);
    if (!viewerToken) throw new Error('viewer token missing before fresh-client verification');
    const freshContext = await authenticatedContext(browser, baseURL, viewerToken);
    contexts.push(freshContext); const freshPage = await freshContext.newPage(); pages.push(freshPage);
    await freshPage.goto(`/studio/board/${boardId}`); await waitSynced(freshPage); freshClient = await clientResult('fresh', freshPage, operations.length);
    await Promise.all(contexts.map(context => context.close())); contexts.length = 0; pages.length = 0;
    server = await serverResult(boardId, ownerToken);
    const analysis = analyzeSoak({ expectedIds: operations.map(item => item.id), operations, clients: clientResults, freshClient, server, reconnects, config });
    const status = reportStatus(config, analysis, null);
    if (status !== (config.profile === 'acceptance' ? 'accepted' : 'diagnostic-passed')) throw new Error(`soak verdict ${status}: ${JSON.stringify(analysis)}`);
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    if (boardId && ownerToken) await apiRequest(request, ownerToken, 'PATCH', `/whiteboards/${boardId}`, { archived: true }).catch(() => undefined);
    const analysis = analyzeSoak({ expectedIds: operations.map(item => item.id), operations, clients: clientResults, freshClient, server, reconnects, config });
    const report: SoakReport = { schemaVersion: 1, issue: 4144, status: reportStatus(config, analysis, failure), exactSha, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), collaborationStartedAt: collaborationStartedAt?.toISOString() ?? null, collaborationDurationMs,
      environment: { os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, browser: browserVersion, ci: process.env.CI === 'true' },
      config, operations, clients: clientResults, freshClient, server, reconnects, analysis, failure };
    await writeSoakReport(reportPath, report);
  }
});
