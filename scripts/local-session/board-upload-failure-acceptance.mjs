#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Requires an explicitly supplied, already authenticated browser session.
// Only the labelled single upload 503 is injected; successful writes use the real API.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const out = resolve(arg('out', '/private/tmp/wsx-board-upload-failure-evidence'));
const storageState = arg('storage-state');
const expectedLocalOrgId = arg('expected-local-org-id');
assert(storageState, 'Pass --storage-state pointing to an explicitly exported authenticated Playwright session.');
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
mkdirSync(out, {recursive: true});
const results = [];
const sensitiveValues = new Set();
const pageErrors = [], unexpectedConsoleErrors = [], expectedInjectedErrors = [], injectionWindows = [];
let activeInjection = null;
let viewerCleanup = null;
let browser, page, token, boardId, imageBytes, completed = false, releaseFailure;
const redact = value => { let text = String(value).replaceAll(token ?? '\0', '[token]'); for (const secret of sensitiveValues) text = text.replaceAll(secret, '[redacted]'); return text; };
const observeBrowserErrors = (observedPage, label) => {
  observedPage.on('pageerror', error => pageErrors.push({page: label, at: Date.now(), message: redact(error.stack ?? error)}));
  observedPage.on('console', message => {
    if (message.type() !== 'error') return;
    const at = Date.now(), location = message.location();
    const record = {page: label, at, message: redact(message.text()), location: {...location, url: redact(location.url)}};
    const expected = activeInjection;
    if (label === 'owner' && expected && at >= expected.startedAt && expected.endedAt === null && location.url === expected.url
      && /^Failed to load resource: the server responded with a status of 503(?: \(Service Unavailable\))?$/.test(message.text())
      && expected.consoleErrors === 0) {
      expected.consoleErrors++; expectedInjectedErrors.push({...record, windowId: expected.id, status: 503, flow: expected.flow});
    } else unexpectedConsoleErrors.push(record);
  });
};
const beginInjected503 = (url, flow) => {
  const window = {id: injectionWindows.length + 1, url, flow, status: 503, startedAt: Date.now(), endedAt: null, consoleErrors: 0};
  injectionWindows.push(window); activeInjection = window; return window;
};
const endInjected503 = window => { if (window) { window.endedAt = Date.now(); if (activeInjection === window) activeInjection = null; } };
const injectedCorsHeaders = () => ({'access-control-allow-origin': new URL(base).origin, 'access-control-allow-credentials': 'true'});
const poll = async (read, predicate, label) => {
  const until = Date.now() + 30000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
};
const check = async (name, run) => {
  try { const detail = await run(); assert.equal(pageErrors.length + unexpectedConsoleErrors.length, 0, 'Unexpected browser errors fail acceptance; see error fields in results.json'); results.push({name, ok: true, detail}); console.log('PASS', name); }
  catch (error) { results.push({name, ok: false, detail: redact(error.stack ?? error)}); await page?.screenshot({path: join(out, `failure-${results.length}.png`)}).catch(() => {}); throw error; }
};
const api = async (method, path, body) => {
  const response = await page.request.fetch(`${apiOrigin}${path}`, {method, headers: {authorization: `Bearer ${token}`}, data: body});
  assert(response.ok(), `${method} ${path}: ${response.status()}`); return response;
};
const snapshot = async () => {
  const exported = await (await api('POST', `/whiteboards/${boardId}/imports/standard-export`, {requestId: randomUUID()})).json();
  const payload = await (await api('GET', exported.downloadPath)).json(), bytes = Buffer.from(payload.contentBase64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256); assert.equal(bytes.length, exported.sizeBytes);
  const value = JSON.parse(bytes.toString('utf8')); assert.equal(value.board.id, boardId); return value.objects;
};
const synced = () => poll(() => page.getByTestId('board-sync-status').getAttribute('data-sync-state'), state => state === 'saved', 'saved header state');
const transfer = name => page.evaluateHandle(({base64, name}) => {
  const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
  const data = new DataTransfer(); data.items.add(new File([bytes], name, {type: 'image/png'})); return data;
}, {base64: imageBytes.toString('base64'), name});
const persistedImage = name => poll(snapshot, objects => objects.some(object => object.extensionData?.contentObject?.fileName === name), `persisted ${name}`).then(objects => objects.find(object => object.extensionData?.contentObject?.fileName === name));
const verifyAsset = async object => {
  const image = object.extensionData.contentObject;
  assert.equal(image.type, 'image'); assert.equal(image.persistence, 'durable'); assert.equal(image.status, 'ready');
  assert.equal(image.contentDigest, `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`);
  assert.deepEqual(await (await api('GET', `/whiteboards/${boardId}/assets/${image.assetId}/content`)).body(), imageBytes);
  assert(!JSON.stringify(object).includes('blob:')); assert(!JSON.stringify(object).includes('data:image'));
  return {objectId: object.id, assetId: image.assetId, contentDigest: image.contentDigest, geometry: object.geometry};
};
try {
  browser = await chromium.launch(process.env.PW_EXECUTABLE ? {executablePath: process.env.PW_EXECUTABLE} : {});
  const context = await browser.newContext({storageState, viewport: {width: 1440, height: 900}, locale: 'zh-CN'});
  page = await context.newPage(); observeBrowserErrors(page, 'owner'); page.setDefaultTimeout(30000);
  const suppliedState = await context.storageState();
  const origin = suppliedState.origins.find(value => value.origin === new URL(base).origin);
  assert(origin, 'Supplied session must contain the exact --base origin.');
  const stored = new Map(origin.localStorage.map(value => [value.name, value.value]));
  token = stored.get('wsx.sessionToken');
  assert(token, 'Supplied session must contain a bearer for the exact --base origin.');
  const metadata = JSON.parse(stored.get('wsx.session') ?? 'null');
  assert(metadata && [1, 2].includes(metadata.version), 'Supplied session metadata must use a supported version.');
  assert(Array.isArray(metadata.orgs) && metadata.orgs.includes(metadata.currentOrgId), 'Supplied session must identify an active organization membership.');
  assert(Date.parse(metadata.expiresAt) > Date.now(), 'Supplied session must not be expired.');
  if (metadata.version === 2) assert.equal(stored.get('wsx.sessionCommit'), metadata.revision, 'Supplied session must be atomically committed; export after board hydration.');
  const bootstrapIdentity = await (await api('GET', `/identity/me?orgId=${encodeURIComponent(metadata.currentOrgId)}`)).json();
  boardId = (await (await api('POST', '/whiteboards', {requestId: randomUUID(), name: `Upload recovery acceptance ${randomUUID()}`})).json()).id;
  assert(boardId); await page.goto(`${base}/studio/board/${boardId}`); await synced();
  assert(await page.evaluate(() => Boolean(localStorage.getItem('wsx.sessionToken'))), 'Browser must retain its supplied session after board hydration.');
  imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d'); context.fillStyle = '#E53935'; context.fillRect(0, 0, 32, 48); context.fillStyle = '#00A86B'; context.fillRect(32, 0, 32, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await check('HTTP image URL is rejected visibly before any source fetch or asset upload', async () => {
    const before = await snapshot(), invalidUrl = `${apiOrigin}/board-upload-invalid.png`;
    let sourceFetches = 0, assetWrites = 0;
    const observe = request => {
      if (request.url() === invalidUrl) sourceFetches++;
      if (request.method() === 'POST' && request.url().endsWith(`/whiteboards/${boardId}/assets`)) assetWrites++;
    };
    page.on('request', observe);
    try {
      await page.keyboard.press('i'); await page.getByTestId('board-image-dropzone').waitFor();
      await page.locator('summary').filter({hasText: '使用图片链接'}).click();
      await page.getByTestId('board-image-url').fill(invalidUrl);
      await page.getByTestId('board-image-url-apply').click();
      await page.getByTestId('board-image-error').waitFor();
      assert((await page.getByTestId('board-image-error').innerText()).includes('HTTPS'));
      await page.getByRole('button', {name: '重试', exact: true}).click();
      await page.getByTestId('board-image-error').waitFor();
      assert(await page.getByTestId('board-image-error').isVisible());
      assert.equal(sourceFetches, 0); assert.equal(assetWrites, 0); assert.deepEqual(await snapshot(), before);
      await page.screenshot({path: join(out, 'invalid-http-url-error.png')});
      await page.getByTestId('board-image-close').click();
      return {sourceFetches, assetWrites, retryRemainsRecoverable: true, limitation: 'URL validation failure only; HTTPS source success not exercised'};
    } finally { page.off('request', observe); }
  });
  await check('I shortcut and dialog image drop use real durable upload', async () => {
    await page.keyboard.press('i'); await page.getByTestId('board-image-dropzone').waitFor();
    const dataTransfer = await transfer('dialog-drop.png');
    try { await page.getByTestId('board-image-dropzone').dispatchEvent('drop', {dataTransfer}); } finally { await dataTransfer.dispose(); }
    const object = await persistedImage('dialog-drop.png'); await synced();
    assert.equal(await page.getByTestId('board-image-dropzone').count(), 0);
    await page.screenshot({path: join(out, 'dialog-drop-saved.png')}); return await verifyAsset(object);
  });
  await check('one injected upload 503 exposes busy/error and retry preserves canvas drop position', async () => {
    const prior = await snapshot(), editor = page.getByTestId('collaborative-editor'), surface = page.getByTestId('board-fabric-surface');
    const bounds = await editor.boundingBox(); assert(bounds);
    const zoom = Number(await surface.getAttribute('data-viewport-zoom')), panX = Number(await surface.getAttribute('data-viewport-pan-x')), panY = Number(await surface.getAttribute('data-viewport-pan-y'));
    const world = {x: (520 - panX) / zoom, y: (320 - panY) / zoom};
    let failureObserved = false;
    let injectionWindow;
    const released = new Promise(resolve => { releaseFailure = resolve; });
    const pattern = `**/whiteboards/${boardId}/assets`;
    const handler = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      failureObserved = true; await released;
      injectionWindow = beginInjected503(route.request().url(), 'canvas insertion');
      await route.fulfill({status: 503, headers: injectedCorsHeaders(), contentType: 'application/json', body: '{"error":"acceptance_injected_upload_failure"}'});
    };
    await page.route(pattern, handler); const dataTransfer = await transfer('retry-drop.png');
    try {
      await editor.dispatchEvent('drop', {dataTransfer, clientX: bounds.x + 520, clientY: bounds.y + 320});
      await poll(async () => failureObserved, Boolean, 'upload reaches the failure route');
      assert(await page.getByTestId('board-image-close').isDisabled());
      await page.screenshot({path: join(out, 'upload-busy.png')}); releaseFailure();
      await page.getByTestId('board-image-error').waitFor();
      assert.equal((await snapshot()).length, prior.length, 'failed upload must not create canonical image');
      await page.screenshot({path: join(out, 'upload-failed.png')});
    } finally { releaseFailure?.(); await page.unroute(pattern, handler); endInjected503(injectionWindow); await dataTransfer.dispose(); }
    await page.getByRole('button', {name: '重试', exact: true}).click();
    const object = await persistedImage('retry-drop.png'); await synced();
    assert(Math.abs(object.geometry.x + object.geometry.width / 2 - world.x) < .01);
    assert(Math.abs(object.geometry.y + object.geometry.height / 2 - world.y) < .01);
    assert.equal((await snapshot()).length, prior.length + 1);
    await page.screenshot({path: join(out, 'retry-drop-saved.png')});
    return {injectedFailure: 'one client upload HTTP 503', retryUsesRealAPI: true, dropWorldPoint: world, ...await verifyAsset(object)};
  });
  await check('image ClipboardEvent uploads once through the real durable path', async () => {
    await page.keyboard.press('Escape'); const before = await snapshot(), dataTransfer = await transfer('paste-image.png');
    try {
      const accepted = await page.getByTestId('collaborative-editor').evaluate((element, clipboardData) => {
        const event = new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true});
        if (event.clipboardData?.files.length !== 1) throw new Error('ClipboardEvent must contain exactly one actual PNG File');
        element.dispatchEvent(event); return event.defaultPrevented;
      }, dataTransfer);
      assert(accepted, 'image paste must be handled by the editor');
    } finally { await dataTransfer.dispose(); }
    const after = await poll(snapshot, objects => objects.length === before.length + 1, 'exactly one new persisted paste object');
    const object = after.find(value => !before.some(prior => prior.id === value.id)); assert(object);
    await synced();
    await page.screenshot({path: join(out, 'paste-image-saved.png')});
    return {inputMethod: 'synthetic browser ClipboardEvent with actual PNG File; native OS clipboard not tested', ...await verifyAsset(object)};
  });
  await check('replacement upload failure retries the same object without changing geometry', async () => {
    const before = await snapshot(), target = before.find(object => object.extensionData?.contentObject?.fileName === 'dialog-drop.png'); assert(target);
    const outline = page.getByTestId(`board-a11y-object-${target.id}`);
    await outline.focus(); await outline.click();
    const expand = page.getByTestId('board-inspector-expand'); if (await expand.isVisible()) await expand.click();
    await page.getByRole('button', {name: '替换', exact: true}).click();
    const pattern = `**/whiteboards/${boardId}/assets`;
    let injectionWindow;
    const handler = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      injectionWindow = beginInjected503(route.request().url(), 'image replacement');
      await route.fulfill({status: 503, headers: injectedCorsHeaders(), contentType: 'application/json', body: '{"error":"acceptance_injected_replacement_failure"}'});
    };
    await page.route(pattern, handler);
    try {
      await page.getByTestId('board-image-dialog-input').setInputFiles({name: 'replacement-retry.png', mimeType: 'image/png', buffer: imageBytes});
      await page.getByTestId('board-image-error').waitFor();
      assert.deepEqual(await snapshot(), before, 'failed replacement cannot modify canonical objects');
      await page.screenshot({path: join(out, 'replacement-failed.png')});
    } finally { await page.unroute(pattern, handler); endInjected503(injectionWindow); }
    await page.getByRole('button', {name: '重试', exact: true}).click();
    const after = await poll(snapshot, objects => objects.some(object => object.id === target.id && object.extensionData?.contentObject?.replacementOf === target.id && object.extensionData?.contentObject?.fileName === 'replacement-retry.png'), 'same target contains the accepted replacement');
    const replacement = after.find(object => object.id === target.id); assert(replacement); await synced();
    assert.equal(replacement.id, target.id); assert.deepEqual(replacement.geometry, target.geometry);
    assert.equal(replacement.extensionData.contentObject.replacementOf, target.id);
    assert.equal((await snapshot()).length, before.length);
    await page.screenshot({path: join(out, 'replacement-retry-saved.png')});
    return {injectedFailure: 'one additional replacement POST 503', targetPreserved: true, ...await verifyAsset(replacement)};
  });
  await check('reload preserves three real images and narrow header shows saved sync state', async () => {
    const prior = await snapshot(); assert.equal(prior.length, 3); await page.reload(); await synced();
    const current = await snapshot(); assert.deepEqual(current.map(object => object.id).sort(), prior.map(object => object.id).sort());
    await poll(() => page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').count(), count => count === 3, 'reloaded image projections');
    await poll(() => page.getByTestId('board-a11y-mirror').locator('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-description'))), descriptions => descriptions.length === 3 && descriptions.every(value => value.includes('图片已验证')), 'reloaded image assets hydrate in browser');
    for (const object of current) await verifyAsset(object);
    await page.screenshot({path: join(out, 'reloaded-desktop.png')}); await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.getByTestId('board-sync-status').getAttribute('data-sync-state'), 'saved');
    assert.equal(await page.getByTestId('board-sync-banner').count(), 0);
    await page.screenshot({path: join(out, 'reloaded-narrow.png')});
    return {objects: current.length, syncState: 'saved', offlineReconnect: 'not exercised; no websocket failure claim'};
  });
  await check('archiving only the acceptance board gates image shortcuts, paste and drop before asset requests', async () => {
    const board = await (await api('GET', `/whiteboards/${boardId}`)).json();
    const before = await snapshot();
    const archived = await (await api('PATCH', `/whiteboards/${boardId}`, {archived: true, expectedLifecycleRevision: board.lifecycleRevision})).json();
    assert(archived.archived);
    let assetWrites = 0;
    const observe = request => { if (request.method() === 'POST' && request.url().endsWith(`/whiteboards/${boardId}/assets`)) assetWrites++; };
    page.on('request', observe);
    try {
      await page.reload(); await synced();
      assert((await page.getByTestId('board-sync-status').getAttribute('aria-label')).includes('只读'));
      await page.keyboard.press('i'); assert.equal(await page.getByTestId('board-image-dropzone').count(), 0);
      const dataTransfer = await transfer('readonly-denied.png');
      try {
        const accepted = await page.getByTestId('collaborative-editor').evaluate((element, clipboardData) => {
          const event = new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true});
          if (event.clipboardData?.files.length !== 1) throw new Error('Readonly ClipboardEvent must contain one PNG File');
          element.dispatchEvent(event); return event.defaultPrevented;
        }, dataTransfer);
        assert.equal(accepted, false, 'readonly image paste must not be handled as a mutation');
        await page.getByTestId('collaborative-editor').dispatchEvent('drop', {dataTransfer, clientX: 250, clientY: 300});
      } finally { await dataTransfer.dispose(); }
      await page.waitForTimeout(300);
      assert.equal(assetWrites, 0);
      assert.equal(await page.getByTestId('board-image-dropzone').count(), 0);
      assert.equal(await page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').count(), before.length);
      await page.screenshot({path: join(out, 'archived-readonly-gate.png')});
    } finally {
      page.off('request', observe);
      await api('PATCH', `/whiteboards/${boardId}`, {archived: false, expectedLifecycleRevision: archived.lifecycleRevision});
      await page.reload(); await synced();
    }
    assert.deepEqual(await snapshot(), before);
    return {readonlyReason: 'archived acceptance-owned board, not viewer role', assetWrites, restored: true};
  });
  if (expectedLocalOrgId) await check('real temporary viewer reads assets and files but cannot upload or mutate through image entries', async () => {
    for (const origin of [base, apiOrigin]) {
      const url = new URL(origin); assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1', 'Temporary viewer provisioning is restricted to the explicit local runtime');
    }
    assert.equal(metadata.currentOrgId, expectedLocalOrgId); assert.equal(bootstrapIdentity.org.id, expectedLocalOrgId);
    assert.equal(bootstrapIdentity.org.name, '我的本地工作区'); assert.equal(bootstrapIdentity.org.kind, 'organization'); assert.equal(bootstrapIdentity.orgRole, 'admin');
    const before = await snapshot();
    const email = `board-viewer-${randomUUID()}@local.workspacex`, temporaryPassword = `${randomUUID()}-${randomUUID()}`;
    sensitiveValues.add(temporaryPassword);
    const cleanup = {boardMemberRemoved: false, orgMemberRemoved: false, pendingInviteRevoked: false, revokedSessions: 0, credentialRetained: false, errors: []};
    viewerCleanup = cleanup;
    let invited, activated, viewerContext;
    try {
      invited = await (await api('POST', `/organizations/${expectedLocalOrgId}/invites`, {orgId: expectedLocalOrgId, email, orgRole: 'consultant', teamId: ''})).json();
      if (invited.activationToken) sensitiveValues.add(invited.activationToken);
      assert(invited.tokenIssued && invited.activationToken, 'Local invitation policy must actually issue the test activation; do not bypass a canInvite restriction');
      const activation = await page.request.post(`${apiOrigin}/org-invites/activate`, {data: {token: invited.activationToken, mode: 'new-account', profile: {name: 'Board upload acceptance viewer', password: temporaryPassword}, sessionId: null}});
      assert(activation.ok(), `temporary viewer activation: ${activation.status()}`); activated = await activation.json();
      cleanup.credentialRetained = true;
      sensitiveValues.add(activated.session.sessionToken); assert.equal(activated.orgId, expectedLocalOrgId); assert.equal(activated.orgRole, 'consultant');
      await api('PUT', `/whiteboards/${boardId}/members`, {userId: activated.userId, role: 'viewer'});
      viewerContext = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'zh-CN'});
      const viewerPage = await viewerContext.newPage(); observeBrowserErrors(viewerPage, 'viewer'); viewerPage.setDefaultTimeout(30000);
      await viewerPage.goto(`${base}/login`); await viewerPage.getByTestId('login-email').fill(email); await viewerPage.getByTestId('login-password').fill(temporaryPassword);
      await viewerPage.getByTestId('login-submit').click(); await viewerPage.waitForURL(url => !url.pathname.startsWith('/login'));
      const viewerToken = await viewerPage.evaluate(() => localStorage.getItem('wsx.sessionToken')); assert(viewerToken); sensitiveValues.add(viewerToken);
      const viewerHeaders = {authorization: `Bearer ${viewerToken}`};
      const viewerBoard = await viewerPage.request.get(`${apiOrigin}/whiteboards/${boardId}`, {headers: viewerHeaders}); assert(viewerBoard.ok());
      assert.equal((await viewerBoard.json()).role, 'viewer', 'Role must come from real Board API, not an archived owner or client mock');
      await viewerPage.goto(`${base}/studio/board/${boardId}`);
      await poll(() => viewerPage.getByTestId('board-sync-status').getAttribute('data-sync-state'), state => state === 'saved', 'viewer connects online');
      assert((await viewerPage.getByTestId('board-sync-status').getAttribute('aria-label')).includes('只读'));
      let assetWrites = 0;
      const observe = request => { if (request.method() === 'POST' && request.url().endsWith(`/whiteboards/${boardId}/assets`)) assetWrites++; };
      viewerPage.on('request', observe);
      await viewerPage.keyboard.press('i'); assert.equal(await viewerPage.getByTestId('board-image-dropzone').count(), 0);
      await viewerPage.getByTestId('collaborative-editor').evaluate((element, base64) => {
        const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], 'viewer-denied.png', {type: 'image/png'}));
        element.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
        element.dispatchEvent(new DragEvent('drop', {dataTransfer: data, clientX: 250, clientY: 300, bubbles: true, cancelable: true}));
      }, imageBytes.toString('base64'));
      await viewerPage.waitForTimeout(300); assert.equal(assetWrites, 0); viewerPage.off('request', observe);
      const image = before[0].extensionData.contentObject;
      const readableImage = await viewerPage.request.get(`${apiOrigin}/whiteboards/${boardId}/assets/${image.assetId}/content`, {headers: viewerHeaders}); assert(readableImage.ok()); assert.deepEqual(await readableImage.body(), imageBytes);
      const deniedImage = await viewerPage.request.post(`${apiOrigin}/whiteboards/${boardId}/assets`, {headers: viewerHeaders, multipart: {file: {name: 'viewer-denied.png', mimeType: 'image/png', buffer: imageBytes}}});
      assert([403, 404].includes(deniedImage.status()), `valid viewer image multipart must be denied by ACL, got ${deniedImage.status()}`);
      const fileBytes = Buffer.from(`Temporary viewer file ACL ${randomUUID()}`);
      const ownerFile = await page.request.post(`${apiOrigin}/whiteboards/${boardId}/files`, {headers: {authorization: `Bearer ${token}`}, multipart: {file: {name: 'viewer-readable.txt', mimeType: 'text/plain', buffer: fileBytes}}}); assert(ownerFile.ok());
      const file = await ownerFile.json();
      const readableFile = await viewerPage.request.get(`${apiOrigin}/whiteboards/${boardId}/files/${file.assetId}/content`, {headers: viewerHeaders}); assert(readableFile.ok()); assert.deepEqual(await readableFile.body(), fileBytes);
      const deniedFile = await viewerPage.request.post(`${apiOrigin}/whiteboards/${boardId}/files`, {headers: viewerHeaders, multipart: {file: {name: 'viewer-denied.txt', mimeType: 'text/plain', buffer: fileBytes}}});
      assert([403, 404].includes(deniedFile.status()), `valid viewer file multipart must be denied by ACL, got ${deniedFile.status()}`);
      assert.deepEqual(await snapshot(), before); await viewerPage.screenshot({path: join(out, 'real-viewer-upload-gate.png')});
      return {role: 'viewer', imageGET: readableImage.status(), fileGET: readableFile.status(), imagePOST: deniedImage.status(), filePOST: deniedFile.status(), browserAssetWrites: assetWrites, userId: activated.userId};
    } finally {
      await viewerContext?.close().catch(error => cleanup.errors.push(redact(error.message)));
      if (activated?.userId) {
        try { await api('DELETE', `/whiteboards/${boardId}/members/${encodeURIComponent(activated.userId)}`); cleanup.boardMemberRemoved = !(await (await api('GET', `/whiteboards/${boardId}/members`)).json()).items.some(member => member.userId === activated.userId); } catch (error) { cleanup.errors.push(redact(error.message)); }
        try { const removal = await (await api('POST', `/organizations/${expectedLocalOrgId}/members/${encodeURIComponent(activated.userId)}/remove`, {orgId: expectedLocalOrgId, userId: activated.userId})).json(); cleanup.revokedSessions = removal.revokedSessions; cleanup.orgMemberRemoved = !(await (await api('GET', `/organizations/${expectedLocalOrgId}/members`)).json()).members.some(member => member.userId === activated.userId); } catch (error) { cleanup.errors.push(redact(error.message)); }
        assert(cleanup.boardMemberRemoved && cleanup.orgMemberRemoved && cleanup.errors.length === 0, 'Temporary viewer membership cleanup must succeed; see viewerCleanup report');
      } else if (invited?.inviteId) {
        try { await api('POST', `/organizations/${expectedLocalOrgId}/invites/${encodeURIComponent(invited.inviteId)}/revoke`, {orgId: expectedLocalOrgId, inviteId: invited.inviteId}); cleanup.pendingInviteRevoked = true; } catch (error) { cleanup.errors.push(redact(error.message)); }
        assert(cleanup.pendingInviteRevoked && cleanup.errors.length === 0, 'Unactivated viewer invitation cleanup must succeed');
      }
    }
  });
  completed = true;
} catch (error) {
  if (!results.some(result => !result.ok)) results.push({name: 'setup', ok: false, detail: redact(error.stack ?? error)});
} finally {
  releaseFailure?.();
  try { await browser?.close(); } catch (error) { pageErrors.push({page: 'shutdown', at: Date.now(), message: redact(error.stack ?? error)}); }
  const browserErrors = [...pageErrors.map(error => ({kind: 'pageerror', ...error})), ...unexpectedConsoleErrors.map(error => ({kind: 'consoleerror', ...error}))];
  const browserErrorGatePassed = pageErrors.length === 0 && unexpectedConsoleErrors.length === 0;
  const ok = completed && results.length === (expectedLocalOrgId ? 8 : 7) && results.every(result => result.ok) && browserErrorGatePassed && injectionWindows.length === 2;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ok, boardId, base, apiOrigin, viewerGateRequested: Boolean(expectedLocalOrgId), viewerGateExercised: results.some(result => result.ok && result.detail?.role === 'viewer'), viewerCleanup, browserErrorGatePassed, errors: browserErrors, browserErrors, pageErrors, unexpectedConsoleErrors, expectedInjectedErrors, injectionWindows, results}, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board Upload Recovery Acceptance\n\nResult: ${ok ? 'PASS' : 'FAIL'}\nBrowser Error Gate: ${browserErrorGatePassed ? 'PASS' : 'FAIL'}; page errors ${pageErrors.length}; unexpected console errors ${unexpectedConsoleErrors.length}; explicitly expected injected console errors ${expectedInjectedErrors.length}. Full error records and exact injection URL/time windows are always in results.json.\n\n${results.map(result => `- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : `: ${result.detail.split('\n')[0]}`}`).join('\n')}\n\nTwo upload 503 responses are deliberately injected, one for insertion and one for replacement. Only each injection's exact URL, standard Chromium 503 message and active time window can permit one console error. Every page error and other console error fails the suite. Successful uploads and persisted bytes use the real API. Paste uses a browser ClipboardEvent, not the native OS clipboard. Archived-owner readonly and actual viewer are distinct checks. Real viewer provisioning requires the explicitly confirmed local bootstrap org ID; organization and board memberships are removed in finally, and the temporary credential remains without those memberships (no raw database deletion). Viewer cleanup: ${JSON.stringify(viewerCleanup)}. HTTPS URL success and offline/reconnect are not exercised.\n`);
  process.exitCode = ok ? 0 : 1;
}
