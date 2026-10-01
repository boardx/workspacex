#!/usr/bin/env node
// Candidate-attested local runtime; API seeds fixtures, real browser input exercises navigation.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import { verifyNavigationRuntime } from './board-navigation-acceptance-runtime.mjs';
import { savedSequence } from './board-acceptance-runtime.mjs';
import { assertHeldUncommitted, assertReleasedOnce, assertCancelled, assertEraseTransaction } from './board-navigation-acceptance-classifier.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base'); assert(base, '--base required');
const apiOrigin = arg('api'); assert(apiOrigin, '--api required');
const out = resolve(arg('out', '/private/tmp/wsx-board-navigation-evidence'));
const data = arg('data-dir');
const continueOnFailure = process.argv.includes('--continue-on-failure');
const storageStateOut = arg('storage-state-out', null);
const storageStateIn = arg('storage-state', null);
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
const {register} = createRequire(join(root, 'package.json'))('tsx/esm/api');
register();
const {WhiteboardOperationRequest} = await import('../../packages/contracts/src/whiteboard-operation.ts');
const {createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, createContentObjectEnvelope} = await import('../../packages/whiteboard-core/src/index.ts');
mkdirSync(out, {recursive: true});
const attestation = verifyNavigationRuntime({ manifestPath: arg('runtime-manifest'), root, base, origin: apiOrigin });
const results = [];
const browserErrors = [];
let browser, page, token, boardId, principal, completed = false;
const redact = value => String(value).replaceAll(token ?? '\0', '[token]').replaceAll(password ?? '\0', '[password]');
let password;
const check = async (name, run) => {
  const started = Date.now();
  try { const detail = await run(); results.push({name, ok: true, ms: Date.now() - started, detail}); console.log('PASS', name); }
  catch (error) {
    const detail = redact(error.stack ?? error);
    results.push({name, ok: false, ms: Date.now() - started, detail});
    await page?.screenshot({path: join(out, `fail-${results.length}.png`)}).catch(() => {});
    console.log('FAIL', name, detail.split('\n')[0]);
    if (page) {
      for (const button of ['left', 'middle', 'right']) await page.mouse.up({button}).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
    if (continueOnFailure) return;
    throw error;
  }
};
const poll = async (read, predicate, label) => {
  const until = Date.now() + 30000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
};
const api = async (method, path, body) => {
  const response = await page.request.fetch(`${apiOrigin}${path}`, {method, headers: {authorization: `Bearer ${token}`}, data: body});
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response;
};
const snapshot = async () => {
  const exported = await (await api('POST', `/whiteboards/${boardId}/imports/standard-export`, {requestId: randomUUID()})).json();
  const downloaded = await (await api('GET', exported.downloadPath)).json();
  const bytes = Buffer.from(downloaded.contentBase64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256);
  assert.equal(bytes.length, exported.sizeBytes);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(value.board.id, boardId);
  return value;
};
const rows = () => page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').evaluateAll(elements => elements.map(element => ({id: element.dataset.objectId, kind: element.dataset.objectKind, text: element.dataset.objectText, geometry: JSON.parse(element.dataset.geometry), from: element.dataset.connectorFrom, to: element.dataset.connectorTo})));
const surface = () => page.getByTestId('board-fabric-surface');
const connectorPixels = () => surface().locator('canvas.lower-canvas').evaluate(canvas => {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0, x = 0, y = 0;
  for (let index = 0; index < data.length; index += 4) if (data[index] > 150 && data[index + 1] < 80 && data[index + 2] > 180) {
    count++; x += (index / 4) % canvas.width; y += Math.floor(index / 4 / canvas.width);
  }
  return { count, x: x / count, y: y / count };
});
const inkAt = point => surface().locator('canvas.lower-canvas').evaluate((canvas, point) => {
  const box = canvas.getBoundingClientRect(), sx = canvas.width / box.width, sy = canvas.height / box.height;
  const data = canvas.getContext('2d').getImageData(Math.round((point.x - box.x - 4) * sx), Math.round((point.y - box.y - 4) * sy), Math.max(1, Math.round(8 * sx)), Math.max(1, Math.round(8 * sy))).data;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 200 && Math.max(data[index], data[index + 1], data[index + 2]) < 80) count++;
  return count;
}, point);
const viewport = async () => Promise.all(['zoom', 'pan-x', 'pan-y'].map(key => surface().getAttribute(`data-viewport-${key}`)));
const point = async id => {
  const box = await surface().boundingBox(); assert(box);
  const scenes = JSON.parse(await surface().getAttribute('data-object-scenes'));
  const scene = scenes.find(value => value.id === id); assert(scene, `Missing visible projection ${id}`);
  const [zoom, x, y] = (await viewport()).map(Number);
  return {x: box.x + x + (scene.left + scene.width / 2) * zoom, y: box.y + y + (scene.top + scene.height / 2) * zoom};
};
const synced = async () => {
  await page.getByTestId('board-sync-status').waitFor();
  return poll(() => page.getByTestId('board-sync-status').getAttribute('aria-label'), value => savedSequence(value) !== null, 'server acknowledged sync state');
};
const clickCanvas = async (x, y) => surface().click({position: {x, y}});
const drag = async (start, end, button = 'left') => { await page.mouse.move(start.x, start.y); await page.mouse.down({button}); await page.mouse.move(end.x, end.y, {steps: 12}); await page.mouse.up({button}); };
const finishText = async text => {
  const editor = page.getByTestId('board-thinking-editor');
  await editor.waitFor(); await editor.fill(text); await editor.press('Control+Enter');
};
try {
  await check('authorized session and real board creation', async () => {
    let storage;
    if (storageStateIn) {
      storage = JSON.parse(readFileSync(resolve(storageStateIn), 'utf8'));
      const origin = storage.origins.find(value => value.origin === new URL(base).origin); assert(origin, 'authorized state must match exact web origin');
      const values = Object.fromEntries(origin.localStorage.map(value => [value.name, value.value]));
      const session = JSON.parse(values['wsx.session']); token = values['wsx.sessionToken']; assert(token);
      assert.equal(session.version, 2); assert.equal(session.revision, values['wsx.sessionCommit']);
      assert(session.orgs.includes(session.currentOrgId)); assert(Date.parse(session.expiresAt) > Date.now());
      principal = {userId: session.userId, orgs: session.orgs};
    }
    browser = await chromium.launch(process.env.PW_EXECUTABLE ? {executablePath: process.env.PW_EXECUTABLE} : {});
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'zh-CN', ...(storage ? {storageState: storage} : {})});
    page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(redact(error.message)));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(redact(message.text())); });
    page.setDefaultTimeout(30000);
    if (!storage) {
      password = JSON.parse(readFileSync(join(data, 'secrets.json'), 'utf8')).adminPassword; assert.equal(typeof password, 'string');
      await page.goto(`${base}/login`);
      await page.getByTestId('login-email').fill('me@local.workspacex');
      await page.getByTestId('login-password').fill(password);
      const login = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
      await page.getByTestId('login-submit').click(); principal = await (await login).json();
      await page.waitForURL(url => !url.pathname.startsWith('/login'));
      token = await page.evaluate(() => localStorage.getItem('wsx.sessionToken')); assert(token);
    } else {
      const session = JSON.parse(storage.origins.find(value => value.origin === new URL(base).origin).localStorage.find(value => value.name === 'wsx.session').value);
      const identity = await (await api('GET', `/identity/me?orgId=${encodeURIComponent(session.currentOrgId)}`)).json();
      assert.equal(identity.org.id, session.currentOrgId, 'server validates active organization membership before creating board'); assert(identity.orgRole);
    }
    boardId = (await (await api('POST', '/whiteboards', {requestId: randomUUID(), name: `Input UX acceptance ${randomUUID()}`})).json()).id;
    assert(boardId); await page.goto(`${base}/studio/board/${boardId}`); await synced(); assert.equal((await rows()).length, 0);
    if (storageStateOut) {
      const statePath = resolve(storageStateOut);
      assert(statePath.startsWith('/private/tmp/') || statePath.startsWith('/tmp/'), 'storage state export requires explicit temporary path');
      const validSession = await page.evaluate(() => {
        const session = JSON.parse(localStorage.getItem('wsx.session'));
        return Boolean(localStorage.getItem('wsx.sessionToken')) && session.version === 2 && session.revision === localStorage.getItem('wsx.sessionCommit') && session.orgs.includes(session.currentOrgId) && Date.parse(session.expiresAt) > Date.now();
      });
      assert(validSession, 'hydrated active board session must be committed and valid before export');
      writeFileSync(statePath, JSON.stringify(await page.context().storageState()), {mode: 0o600}); chmodSync(statePath, 0o600);
    }
    return {boardId, route: new URL(page.url()).pathname, authentication: storage ? 'authorized-storage-state' : 'real-password-login'};
  });

  const canonicalState = async () => ({ head: await (await api('GET', `/v1/whiteboards/${boardId}/head`)).json(), objects: (await snapshot()).objects });
  const submit = async commands => {
    const head = await (await api('GET', `/v1/whiteboards/${boardId}/head`)).json();
    const orgId = await page.evaluate(() => JSON.parse(localStorage.getItem('wsx.session')).currentOrgId);
    assert.equal(head.role, 'owner');
    await api('POST', `/v1/whiteboards/${boardId}/operations`, WhiteboardOperationRequest.parse({
      apiVersion: '2026-09-01', requestId: randomUUID(), boardId, expectedRevision: { epoch: head.epoch, seq: head.seq },
      actor: { kind: 'human', actorId: principal.userId, orgId, role: head.role, scopes: ['board:read', 'board:write'], delegatedBy: null },
      provenance: { source: 'human', model: null, skill: null, sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: [] }, commands,
    }));
  };
  await check('canonical owner seeds navigation fixtures', async () => {
    const objects = ['sticky', 'rectangle'].map((kind, index) => ({ id: randomUUID(), schemaVersion: 1, kind,
      geometry: { x: 150 + index * 300, y: 240, width: 120, height: 100, rotation: 0 }, text: kind, style: { fill: '#CAE0FF' }, parentId: null, orderKey: String(index) }));
    await submit(objects.map(object => ({ type: 'create', object })));
    await page.reload(); await synced();
    assert.deepEqual((await canonicalState()).objects, objects);
    return { ids: objects.map(object => object.id), seed: 'authenticated canonical API' };
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('board-zoom-fit-board').click();
  await check(`wheel, middle/right pan width ${width}`, async () => {
    const box = await surface().boundingBox(); assert(box);
    const canonicalBefore = await canonicalState();
    const start = {x: box.x + box.width * .7, y: box.y + 160};
    await page.mouse.move(start.x, start.y); let before = await viewport(); await page.mouse.wheel(0, 160);
    await poll(viewport, value => JSON.stringify(value) !== JSON.stringify(before), 'wheel viewport');
    for (const modifier of ['Control', 'Meta']) {
      before = await viewport(); await page.keyboard.down(modifier);
      const [z, px, py] = before.map(Number);
      const local = { x: start.x - box.x, y: start.y - box.y };
      const world = { x: (local.x - px) / z, y: (local.y - py) / z };
      try { await page.mouse.wheel(0, -160); } finally { await page.keyboard.up(modifier); }
      const after = (await poll(viewport, value => Number(value[0]) !== Number(before[0]), `${modifier} wheel zoom`)).map(Number);
      assert(Math.abs(world.x * after[0] + after[1] - local.x) <= 2 && Math.abs(world.y * after[0] + after[2] - local.y) <= 2, `${modifier} zoom preserves cursor world anchor`);
    }
    for (const button of ['middle', 'right']) {
      before = await viewport(); await drag(start, {x: start.x + 90, y: start.y + 45}, button);
      await poll(viewport, value => JSON.stringify(value) !== JSON.stringify(before), `${button} pan`);
      assert.equal(await page.getByRole('menu').count(), 0, 'pan must not leave context menu');
    }
    assertCancelled(canonicalBefore, await canonicalState());
    await page.getByTestId('board-zoom-fit-board').click(); return { viewport: await viewport(), hardware: 'synthetic software wheel and mouse, not Mac hardware evidence' };
  });
  await check(`live object/handles/menu/connector width ${width}`, async () => {
    await synced(); const before = await rows(); const first = before.find(row => row.kind === 'sticky'); assert(first);
    const target = before.find(row => row.id !== first.id && row.kind !== 'connector'); assert(target);
    const canonical = await snapshot();
    const head = await (await api('GET', `/v1/whiteboards/${boardId}/head`)).json();
    assert.equal(head.role, 'owner'); assert.equal(head.epoch, canonical.board.epoch); assert.equal(head.seq, canonical.board.seq);
    const edgeId = randomUUID();
    const metadata = await (await api('GET', `/whiteboards/${boardId}`)).json();
    assert.equal(metadata.ownerId, principal.userId, 'authenticated user owns seeded board');
    const storedSession = await page.evaluate(() => JSON.parse(localStorage.getItem('wsx.session')));
    assert.equal(storedSession.userId, principal.userId, 'persisted active session belongs to authenticated login');
    assert([1, 2].includes(storedSession.version), 'persisted session schema version');
    assert(Date.parse(storedSession.expiresAt) > Date.now(), 'persisted session remains valid');
    if (storedSession.version === 2) assert.equal(await page.evaluate(() => localStorage.getItem('wsx.sessionCommit')), storedSession.revision, 'persisted session is committed atomically');
    const orgId = storedSession.currentOrgId;
    assert.equal(typeof orgId, 'string', 'persisted session identifies active organization');
    assert(principal.orgs.includes(orgId), 'active organization belongs to authenticated login membership list');
    assert(storedSession.orgs.includes(orgId), 'active organization belongs to persisted session membership list');
    const identity = await (await api('GET', `/identity/me?orgId=${encodeURIComponent(orgId)}`)).json();
    assert.equal(identity.org.id, orgId, 'identity API verifies active organization membership');
    assert(identity.orgRole, 'identity API must return organization role');
    // Calculate the existing edge with the same domain command used by the application.
    const doc = createWhiteboardDocument();
    executeCommands(doc, canonical.objects.map(object => ({type: 'create', object})));
    new SpatialRelationshipCommandPort(doc).dispatch({boardId, clientId: 'acceptance-seed', gestureId: randomUUID(), command: {
      type: 'create-connector', id: edgeId, relationship: {from: first.id, to: target.id, fromAnchor: 'right', toAnchor: 'left', type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: ''},
    }});
    const seededEdge = readObjects(doc).find(object => object.id === edgeId); assert(seededEdge);
    seededEdge.style = {stroke: '#CC00FF'}; doc.destroy();
    const seedOperation = WhiteboardOperationRequest.parse({
      apiVersion: '2026-09-01', requestId: randomUUID(), boardId, expectedRevision: {epoch: head.epoch, seq: head.seq},
      actor: {kind: 'human', actorId: principal.userId, orgId, role: head.role, scopes: ['board:read', 'board:write'], delegatedBy: null},
      provenance: {source: 'human', model: null, skill: null, sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: []},
      commands: [{type: 'create', object: seededEdge}],
    });
    await api('POST', `/v1/whiteboards/${boardId}/operations`, seedOperation);
    await page.reload(); await synced(); await page.getByTestId('board-zoom-fit-board').click();
    await page.getByTestId('board-tool-select').click(); const start = await point(first.id);
    await page.mouse.click(start.x, start.y);
    const handle = page.getByTestId(`connector-handle-${first.id}-right`);
    const toolbar = page.getByTestId('board-context-toolbar');
    await handle.waitFor(); await toolbar.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const handlesState = () => page.locator(`[data-testid^="connector-handle-${first.id}-"]`).evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {id: element.dataset.testid, left: element.style.left, top: element.style.top, transform: style.transform, width: style.width, height: style.height, box: {x: box.x, y: box.y, width: box.width, height: box.height}};
    }));
    const beforeHandles = await handlesState();
    const beforeScenes = JSON.parse(await surface().getAttribute('data-object-scenes'));
    const beforeHandle = await handle.boundingBox(), beforeToolbar = await toolbar.boundingBox(); assert(beforeHandle && beforeToolbar);
    const magenta = () => surface().locator('canvas.lower-canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d'), data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0, x = 0, y = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index] > 150 && data[index + 1] < 80 && data[index + 2] > 180) { count++; x += (index / 4) % canvas.width; y += Math.floor(index / 4 / canvas.width); }
      return {count, x: x / count, y: y / count};
    });
    const beforePixels = await poll(magenta, value => value.count > 20, 'existing connector rendered pixels');
    const beforeMove = await snapshot(); const beforeCanonical = await canonicalState();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 70, start.y + 40, {steps: 12});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const liveHandle = await poll(() => handle.boundingBox(), value => value && Math.abs(value.x - beforeHandle.x) > 20, 'live handle translation');
    const liveToolbar = await toolbar.boundingBox(); assert(liveToolbar);
    assert(Math.abs(liveToolbar.x - beforeToolbar.x) > 10 || Math.abs(liveToolbar.y - beforeToolbar.y) > 10, 'object toolbar follows drag before commit');
    const livePixels = await poll(magenta, value => value.count > 20 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 5, 'existing connector pixels follow during drag');
    const measured = {start, canonicalGeometry: beforeMove.objects.find(object => object.id === first.id)?.geometry, beforeScenes, liveScenes: JSON.parse(await surface().getAttribute('data-object-scenes')), beforeHandles, liveHandles: await handlesState(), requestedDelta: {x: 70, y: 40}, actualHandleDelta: {x: liveHandle.x - beforeHandle.x, y: liveHandle.y - beforeHandle.y}, beforeHandle, liveHandle, beforeToolbar, liveToolbar, beforePixels, livePixels, viewport: await viewport()};
    writeFileSync(join(out, `live-drag-measurements-${width}.json`), JSON.stringify(measured, null, 2));
    await page.screenshot({path: join(out, `live-drag-${width}.png`)});
    assert(Math.abs(measured.actualHandleDelta.x - 70) <= 8 && Math.abs(measured.actualHandleDelta.y - 40) <= 8, `handle matches live screen displacement: ${JSON.stringify(measured)}`);
    assertHeldUncommitted(beforeCanonical, await canonicalState());
    await page.screenshot({path: join(out, `live-drag-${width}.png`)}); await page.mouse.up(); await synced();
    const afterCanonical = await poll(canonicalState, value => value.head.seq > beforeCanonical.head.seq, 'release server transaction'); assertReleasedOnce(beforeCanonical, afterCanonical);
    const moved = await poll(rows, value => value.find(row => row.id === first.id).geometry.x !== first.geometry.x, 'committed object movement');
    const edgeRow = page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${edgeId}"]`);
    const anchor = JSON.parse(await edgeRow.getAttribute('data-connector-start'));
    const geometry = moved.find(row => row.id === first.id).geometry;
    const angle = geometry.rotation * Math.PI / 180;
    const expectedAnchor = { x: geometry.x + geometry.width * Math.cos(angle) - geometry.height / 2 * Math.sin(angle), y: geometry.y + geometry.width * Math.sin(angle) + geometry.height / 2 * Math.cos(angle) };
    assert(Math.abs(anchor.x - expectedAnchor.x) < 1 && Math.abs(anchor.y - expectedAnchor.y) < 1, 'connector remains attached to actual rotated right anchor after commit');
    return {edgeId, beforeHandle, liveHandle, beforeToolbar, liveToolbar, beforePixels, livePixels, anchor};
  });

  for (const mode of ['resize', 'rotate']) await check(`held ${mode} controls/menu/edge width ${width}`, async () => {
    await page.getByTestId('board-tool-select').click();
    const object = (await rows()).find(row => row.kind === 'sticky');
    const center = await point(object.id); await page.mouse.click(center.x, center.y);
    const before = await canonicalState();
    const geometry = before.objects.find(item => item.id === object.id).geometry;
    const box = await surface().boundingBox(), [zoom, px, py] = (await viewport()).map(Number);
    const radians = geometry.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    const local = mode === 'resize' ? { x: geometry.width, y: geometry.height } : { x: geometry.width / 2, y: geometry.height };
    const offset = mode === 'rotate' ? 40 : 0;
    const start = { x: box.x + px + (geometry.x + local.x * c - local.y * s) * zoom - offset * s,
      y: box.y + py + (geometry.y + local.x * s + local.y * c) * zoom + offset * c };
    const handle = page.getByTestId(`connector-handle-${object.id}-right`), toolbar = page.getByTestId('board-context-toolbar');
    const beforeHandle = await handle.boundingBox(), beforeToolbar = await toolbar.boundingBox(); assert(beforeHandle && beforeToolbar);
    const beforePixels = await poll(connectorPixels, value => value.count > 20, 'attached connector pixels');
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + (mode === 'resize' ? 25 : 45), start.y + (mode === 'resize' ? 18 : -12), { steps: 12 });
    const liveHandle = await poll(() => handle.boundingBox(), value => value && Math.hypot(value.x - beforeHandle.x, value.y - beforeHandle.y) > 3, `${mode} live anchor moves`);
    const liveToolbar = await toolbar.boundingBox(); assert(liveToolbar);
    assert(liveToolbar.x >= 0 && liveToolbar.x + liveToolbar.width <= width + 1, 'live toolbar remains inside viewport');
    const livePixels = await poll(connectorPixels, value => value.count > 20 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 1, `${mode} connector pixels follow before release`);
    assertHeldUncommitted(before, await canonicalState());
    await page.screenshot({ path: join(out, `${mode}-held-${width}.png`) });
    await page.mouse.up(); await synced();
    const after = await poll(canonicalState, value => value.head.seq > before.head.seq, `${mode} release`);
    assertReleasedOnce(before, after);
    const changed = after.objects.find(item => item.id === object.id).geometry;
    if (mode === 'resize') assert(changed.width !== geometry.width || changed.height !== geometry.height, 'resize changes dimensions, not merely translation');
    else assert(changed.rotation !== geometry.rotation, 'rotation control changes angle, not merely translation');
    return { beforeHandle, liveHandle, beforeToolbar, liveToolbar, beforePixels, livePixels, beforeGeometry: geometry, afterGeometry: changed, beforeHead: before.head, afterHead: after.head };
  });
  for (const mode of ['Escape', 'blur']) await check(`cancel held object transform ${mode} width ${width}`, async () => {
    await page.getByTestId('board-tool-select').click();
    const object = (await rows()).find(row => row.kind === 'sticky');
    const start = await point(object.id); await page.mouse.click(start.x, start.y);
    const before = await canonicalState();
    const beforeScene = JSON.parse(await surface().getAttribute('data-object-scenes')).find(item => item.id === object.id);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y + 25, { steps: 8 });
    assertHeldUncommitted(before, await canonicalState());
    if (mode === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up(); await synced(); await page.waitForTimeout(300);
    assertCancelled(before, await canonicalState());
    const afterScene = JSON.parse(await surface().getAttribute('data-object-scenes')).find(item => item.id === object.id);
    for (const key of ['left', 'top', 'width', 'height']) assert(Math.abs(afterScene[key] - beforeScene[key]) < 1, `${mode} restores actual Fabric ${key}`);
    await page.screenshot({ path: join(out, `cancel-${mode}-${width}.png`) });
    return { head: before.head, cancellation: mode, blurEvidence: mode === 'blur' ? 'synthetic window blur event' : undefined };
  });
  await check(`middle/right pan begins on connector DOM overlays width ${width}`, async () => {
    const edgeId = randomUUID(), doc = createWhiteboardDocument();
    executeCommands(doc, (await snapshot()).objects.map(object => ({ type: 'create', object })));
    new SpatialRelationshipCommandPort(doc).dispatch({ boardId, clientId: 'overlay-fixture', gestureId: randomUUID(), command: { type: 'create-connector', id: edgeId,
      relationship: { fromPoint: { x: 280, y: 140 }, toPoint: { x: 460, y: 200 }, type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' } } });
    const edge = readObjects(doc).find(object => object.id === edgeId); doc.destroy();
    await submit([{ type: 'create', object: edge }]); await page.reload(); await synced(); await page.getByTestId('board-zoom-fit-board').click();
    const center = await point(edgeId); await page.mouse.click(center.x, center.y);
    for (const target of ['board-connector-handle-from', 'board-connector-body-hit']) for (const button of ['middle', 'right']) {
      const hit = await page.getByTestId(target).boundingBox(); assert(hit, `${target} must be real selected DOM overlay`);
      const start = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
      const canonical = await canonicalState(), beforeViewport = (await viewport()).map(Number);
      await drag(start, { x: start.x + 35, y: start.y + 20 }, button);
      const afterViewport = (await poll(viewport, values => Math.abs(Number(values[1]) - beforeViewport[1]) > 20, `${button} pan from ${target}`)).map(Number);
      assert(Math.abs(afterViewport[1] - beforeViewport[1] - 35) < 3 && Math.abs(afterViewport[2] - beforeViewport[2] - 20) < 3, 'overlay pan follows screen pointer delta');
      assertCancelled(canonical, await canonicalState());
      assert.equal(await page.getByRole('menu').count(), 0, 'overlay right-pan cannot open context menu');
      await page.screenshot({ path: join(out, `overlay-${target}-${button}-${width}.png`) });
    }
    return { edgeId, targets: ['endpoint DOM button', 'body SVG hit path'], buttons: ['middle', 'right'] };
  });
  await page.screenshot({ path: join(out, `navigation-${width}.png`) });
  }
  await check('multi-object eraser is one transaction and one undo', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const ids = [randomUUID(), randomUUID()], lockedId = randomUUID();
    const commands = [...ids, lockedId].map((id, index) => createContentObjectEnvelope({
      boardId, clientId: 'navigation-fixture', gestureId: randomUUID(), id,
      geometry: { x: 180 + index * 120, y: 480, width: 70, height: 40, rotation: 0 },
      content: { version: 1, type: 'drawing', strokes: [{ id: randomUUID(), tool: 'pen', color: '#222222', width: 5, opacity: 1, points: [{ x: 0, y: 20, pressure: .5 }, { x: 70, y: 20, pressure: .5 }] }] },
    }).commands[0]);
    commands[2].object.locked = true;
    await submit(commands); await page.reload(); await synced(); await page.getByTestId('board-zoom-fit-board').click();
    const before = await canonicalState(), a = await point(ids[0]), b = await point(lockedId);
    const inkPoints = await Promise.all(ids.map(point));
    const beforeInk = await Promise.all(inkPoints.map(location => poll(() => inkAt(location), count => count >= 10, 'seed drawing contains actual dark ink')));
    await page.getByTestId('board-add-draw').click(); await page.getByTestId('board-draw-eraser').click();
    await page.mouse.move(a.x - 30, a.y); await page.mouse.down(); await page.mouse.move(b.x + 30, b.y, { steps: 24 });
    assertHeldUncommitted(before, await canonicalState());
    await page.screenshot({ path: join(out, 'eraser-held.png') }); await page.mouse.up(); await synced();
    const after = await poll(canonicalState, state => state.head.seq > before.head.seq, 'erase transaction');
    assert.deepEqual(after.objects.find(object => object.id === lockedId), before.objects.find(object => object.id === lockedId), 'eraser preserves locked drawing on the same stroke');
    const erasedInk = await Promise.all(inkPoints.map((location, index) => poll(() => inkAt(location), count => count < beforeInk[index] * .25, 'actual ink pixels erased at stroke crossing')));
    assert(await inkAt(b) >= 10, 'locked drawing remains visibly inked');
    await page.screenshot({ path: join(out, 'eraser-masks-visible.png') });
    await page.keyboard.press('Escape');
    const undoButton = page.getByTestId('board-undo');
    if (await undoButton.count()) await undoButton.click(); else await page.keyboard.press('Control+z');
    await synced(); const undone = await poll(canonicalState, state => JSON.stringify(state.objects) === JSON.stringify(before.objects), 'single undo restores both masks and geometry');
    assertEraseTransaction(before, after, undone, ids);
    const undoneInk = await Promise.all(inkPoints.map((location, index) => poll(() => inkAt(location), count => count >= beforeInk[index] * .9, 'single undo restores original ink pixels')));
    await page.screenshot({ path: join(out, 'eraser-undone.png') });
    return { ids, lockedId, beforeInk, erasedInk, undoneInk, beforeHead: before.head, afterHead: after.head, undoneHead: undone.head };
  });
  verifyNavigationRuntime({ manifestPath: arg('runtime-manifest'), root, base, origin: apiOrigin });
  completed = true;
} catch (error) {
  if (!results.some(value => !value.ok)) results.push({name: 'setup', ok: false, detail: redact(error.stack ?? error)});
} finally {
  if (boardId && page && token) {
    try {
      const owned = await (await api('GET', `/whiteboards/${boardId}`)).json();
      assert.equal(owned.ownerId, principal.userId, 'cleanup may only delete our owned fixture');
      await api('DELETE', `/whiteboards/${boardId}`, { requestId: randomUUID(), confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: owned.lifecycleRevision });
      const gone = await page.request.get(`${apiOrigin}/whiteboards/${boardId}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(gone.status(), 404, 'owned fixture deletion verified');
      results.push({ name: 'owned fixture cleanup', ok: true, detail: { status: 404 } });
    } catch (error) { results.push({ name: 'owned fixture cleanup', ok: false, detail: redact(error.stack ?? error) }); }
  }
  await browser?.close().catch(error => browserErrors.push(redact(error.message)));
  const ok = completed && results.length > 0 && results.every(value => value.ok) && browserErrors.length === 0;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ok, boardId, base, apiOrigin, attestation, results, browserErrors, exclusions: ['real Mac trackpad hardware', 'native touch gestures', 'native IME hardware']}, null, 2));
  writeFileSync(join(out, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board Input UX Acceptance\n\nResult: ${ok ? 'PASS' : 'FAIL'}\n\n${results.map(value => `- ${value.ok ? 'PASS' : 'FAIL'} ${value.name}${value.ok ? '' : `: ${value.detail.split('\n')[0]}`}`).join('\n')}\n\nBrowser errors: ${browserErrors.length} (browser-errors.json)\n`);
  process.exitCode = ok ? 0 : 1;
}
