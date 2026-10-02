#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Real WebSocket transport. Only delay genuine server ACKs; never manufacture success.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const state = arg('storage-state', '/private/tmp/wsx-board-ux-authorized-session.json');
const out = resolve(arg('out', '/private/tmp/wsx-board-sync-evidence')); mkdirSync(out, {recursive: true});
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
const evidence = {ok: false, results: [], connections: 0, acknowledgements: 0, errors: [], expectedOfflineErrors: [], offlineInjectionWindow: null};
const consoleErrors = [], failedRequests = [];
let classifiedConsole = 0, classifiedRequests = 0;
const classifyBrowserErrors = () => {
  const window = evidence.offlineInjectionWindow;
  const allowed = event => {
    if (!window || event.at < window.startedAt || event.at > window.endedAt) return false;
    try {
      const url = new URL(event.url);
      return url.origin === new URL(apiOrigin).origin && !url.search &&
        [`/whiteboards/${evidence.boardId}/comments`, `/whiteboards/${evidence.boardId}/head`].includes(url.pathname);
    } catch { return false; }
  };
  for (const event of consoleErrors.slice(classifiedConsole)) {
    const request = failedRequests.find(request => request.url === event.url && request.method === 'GET' &&
      request.reason === 'net::ERR_INTERNET_DISCONNECTED' && allowed(request) && Math.abs(request.at - event.at) <= 2000);
    if (allowed(event) && event.text === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED' && request) {
      evidence.expectedOfflineErrors.push({console: event, request});
    } else evidence.errors.push(redact(JSON.stringify(event)));
  }
  for (const request of failedRequests.slice(classifiedRequests)) {
    if (!evidence.expectedOfflineErrors.some(event => event.request === request)) evidence.errors.push(redact(JSON.stringify(request)));
  }
  classifiedConsole = consoleErrors.length;
  classifiedRequests = failedRequests.length;
};
let browser, page, token, hold = true; const held = [];
const poll = async (read, valid, message) => {
  const deadline = Date.now() + 30000;
  do { const value = await read(); if (valid(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}`);
};
const sync = () => page.getByTestId('board-sync-status').getAttribute('data-sync-state');
const redact = value => String(value).replaceAll(token ?? '\0', '[token]');
try {
  const storage = JSON.parse(readFileSync(state, 'utf8'));
  const origin = storage.origins.find(origin => origin.origin === new URL(base).origin); assert(origin);
  const saved = Object.fromEntries(origin.localStorage.map(value => [value.name, value.value]));
  const session = JSON.parse(saved['wsx.session']); token = saved['wsx.sessionToken']; assert(token);
  assert.equal(session.revision, saved['wsx.sessionCommit']); assert(session.orgs.includes(session.currentOrgId)); assert(Date.parse(session.expiresAt) > Date.now());
  browser = await chromium.launch(process.env.PW_EXECUTABLE ? {executablePath: process.env.PW_EXECUTABLE} : {});
  const context = await browser.newContext({storageState: storage, viewport: {width: 1440, height: 900}});
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => evidence.errors.push(redact(error.message)));
  page.on('console', message => {if (message.type() === 'error') consoleErrors.push({at: Date.now(), text: redact(message.text()), url: message.location().url});});
  page.on('requestfailed', request => failedRequests.push({at: Date.now(), url: request.url(), method: request.method(), reason: request.failure()?.errorText}));
  const api = async (method, path, body) => {
    const response = await context.request.fetch(`${apiOrigin}${path}`, {method, headers: {authorization: `Bearer ${token}`}, data: body});
    assert(response.ok(), `${method} ${path}: ${response.status()}`); return response;
  };
  const identity = await (await api('GET', `/identity/me?orgId=${encodeURIComponent(session.currentOrgId)}`)).json(); assert.equal(identity.org.id, session.currentOrgId);
  const board = await (await api('POST', '/whiteboards', {requestId: randomUUID(), name: `Sync acceptance ${randomUUID()}`})).json(); evidence.boardId = board.id;
  await page.routeWebSocket(url => url.pathname === `/whiteboards/${board.id}/sync`, socket => {
    evidence.connections++;
    const server = socket.connectToServer();
    server.onMessage(message => {
      const parsed = JSON.parse(typeof message === 'string' ? message : message.toString());
      if (parsed.type === 'ack') {
        evidence.acknowledgements++;
        if (hold) {held.push(() => socket.send(message)); return;}
      }
      socket.send(message);
    });
  });
  await page.goto(`${base}/studio/board/${board.id}`); await poll(sync, value => value === 'saved', 'initial sync saved');
  await page.getByTestId('board-add-sticky').click(); await page.getByTestId('board-fabric-surface').click({position: {x: 400, y: 260}});
  const editor = page.getByTestId('board-thinking-editor'); await editor.fill('Genuine delayed ACK'); await editor.press('Control+Enter');
  await poll(() => held.length, value => value > 0, 'real server ACK captured');
  assert.equal(await sync(), 'syncing'); await page.getByTestId('board-sync-spinner').waitFor();
  const pendingLabel = await page.getByTestId('board-sync-status').getAttribute('aria-label'); assert.match(pendingLabel, /待确认|等待服务器|正在同步/);
  await page.screenshot({path: join(out, 'pending-real-ack.png')});
  hold = false; held.splice(0).forEach(send => send());
  await poll(sync, value => value === 'saved', 'released genuine ACK sync saved');
  assert.equal(await page.getByTestId('board-sync-spinner').count(), 0);
  evidence.results.push({name: 'genuine ACK delay shows spinner then saved', ok: true, pendingLabel, acknowledgements: evidence.acknowledgements});
  const priorConnections = evidence.connections;
  evidence.offlineInjectionWindow = {startedAt: Date.now(), endedAt: null, allowedGetPaths: [`/whiteboards/${board.id}/comments`, `/whiteboards/${board.id}/head`]};
  await context.setOffline(true); await poll(sync, value => value === 'offline', 'real browser offline');
  await page.getByTestId('board-retry-sync').waitFor(); await page.screenshot({path: join(out, 'offline.png')});
  await page.getByTestId('board-retry-sync').click(); assert.equal(await sync(), 'offline');
  await context.setOffline(false);
  evidence.offlineInjectionWindow.endedAt = Date.now();
  await poll(sync, value => value === 'saved', 'real network restored'); assert(evidence.connections > priorConnections, 'new real WebSocket connection established');
  const exported = await (await api('POST', `/whiteboards/${board.id}/imports/standard-export`, {requestId: randomUUID()})).json();
  const content = await (await api('GET', exported.downloadPath)).json(); const bytes = Buffer.from(content.contentBase64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256);
  assert(JSON.parse(bytes.toString('utf8')).objects.some(object => object.text === 'Genuine delayed ACK'));
  await page.reload(); await poll(sync, value => value === 'saved', 'reload after reconnect');
  assert.equal(await page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').count(), 1);
  await page.screenshot({path: join(out, 'reconnected-saved.png')});
  evidence.results.push({name: 'offline retry and real reconnect preserve durable write', ok: true, beforeConnections: priorConnections, afterConnections: evidence.connections});
  classifyBrowserErrors();
  assert.deepEqual(evidence.errors, [], 'browser must not report unexpected browser errors'); evidence.ok = true;
} catch (error) {
  evidence.failure = redact(error.stack ?? error); await page?.screenshot({path: join(out, 'failure.png')}).catch(() => {}); console.log('FAIL', evidence.failure.split('\n')[0]);
} finally {
  hold = false; held.splice(0).forEach(send => {try {send();} catch {}});
  await browser?.close().catch(error => evidence.errors.push(redact(error.message)));
  classifyBrowserErrors();
  if (evidence.errors.length) evidence.ok = false;
  writeFileSync(join(out, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log(evidence.ok ? 'PASS sync acceptance' : 'FAIL sync acceptance'); process.exitCode = evidence.ok ? 0 : 1;
}
