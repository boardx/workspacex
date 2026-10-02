#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Real local stack only. Creation uses user input; one existing connector is seeded through the authenticated API.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317');
const apiOrigin = arg('api', 'http://127.0.0.1:3320');
const out = resolve(arg('out', '/private/tmp/wsx-board-input-ux-evidence'));
const data = resolve(arg('data-dir', '/private/tmp/wsx-board-ux-runtime-20261001'));
const continueOnFailure = process.argv.includes('--continue-on-failure');
const storageStateOut = arg('storage-state-out', null);
const storageStateIn = arg('storage-state', null);
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
const {register} = createRequire(join(root, 'package.json'))('tsx/esm/api');
register();
const {WhiteboardOperationRequest} = await import('../../packages/contracts/src/whiteboard-operation.ts');
const {createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort} = await import('../../packages/whiteboard-core/src/index.ts');
mkdirSync(out, {recursive: true});
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
  return poll(() => page.getByTestId('board-sync-status').getAttribute('data-sync-state'), value => value === 'saved', 'board sync semantic state saved');
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
  await check('single click creates one sticky, text, and shape', async () => {
    await page.getByTestId('board-add-sticky').click();
    const colorId = await page.locator('[data-testid^="board-sticky-default-"][aria-pressed="false"]').first().getAttribute('data-testid'); assert(colorId);
    const colorButton = page.getByTestId(colorId);
    await colorButton.click(); await page.getByTestId('board-sticky-circle').click();
    const menuPreview = page.getByTestId('board-sticky-circle').locator('[data-sticky-variant]');
    const dockPreview = page.getByTestId('board-add-sticky').locator('[data-sticky-variant]');
    assert.equal(await dockPreview.getAttribute('data-sticky-variant'), 'circle');
    assert.equal(await page.getByTestId('board-sticky-circle').getAttribute('aria-pressed'), 'true');
    assert.equal(await colorButton.getAttribute('aria-pressed'), 'true');
    const previewStyle = locator => locator.evaluate(element => ({fill: getComputedStyle(element).backgroundColor, radius: getComputedStyle(element).borderRadius}));
    assert.deepEqual(await previewStyle(dockPreview), await previewStyle(menuPreview), 'dock and circle menu preview share selected color and shape');
    await page.mouse.move(1100, 100); await page.screenshot({path: join(out, 'sticky-circle-picker.png')});
    await clickCanvas(350, 230); await finishText('Acceptance sticky');
    await poll(rows, value => value.length === 1 && value[0].text === 'Acceptance sticky', 'one sticky');
    const stickyObject = (await snapshot()).objects[0];
    assert.equal(stickyObject.extensionData.thinkingInput.sticky.variant, 'circle');
    const persistedColor = stickyObject.extensionData.thinkingInput.sticky.color;
    const colorRgb = persistedColor.replace('#', '').match(/../g).map(value => parseInt(value, 16));
    assert.equal((await previewStyle(dockPreview)).fill, `rgb(${colorRgb.join(', ')})`, 'actual sticky color matches dock preview');
    await clickCanvas(1050, 170); await synced(); assert.equal((await rows()).length, 1, 'sticky single-shot resets to selection');
    await page.getByTestId('board-add-text').click(); await clickCanvas(670, 230); await finishText('Acceptance text');
    await poll(rows, value => value.length === 2, 'one text');
    await clickCanvas(1050, 170); await synced(); assert.equal((await rows()).length, 2, 'text single-shot resets to selection');
    await page.getByTestId('board-add-shape').click(); await clickCanvas(850, 400);
    await poll(rows, value => value.length === 3, 'one shape');
    await page.keyboard.press('Escape'); await synced();
    for (let count = 0; count < 2; count++) await clickCanvas(1000, 170 + count * 45);
    await synced(); assert.equal((await rows()).length, 3, 'single-shot tool must stop creating after first object');
    return await rows();
  });
  await check('dock drag and drop creates exactly one object', async () => {
    const before = await rows(); const bounds = await surface().boundingBox(); assert(bounds);
    await page.getByTestId('board-add-sticky').dragTo(surface(), {targetPosition: {x: 420, y: 450}});
    await poll(rows, value => value.length === before.length + 1, 'dock drop');
    const editor = page.getByTestId('board-thinking-editor'); if (await editor.isVisible()) await finishText('Dropped sticky');
    await page.keyboard.press('Escape'); await synced(); return await rows();
  });
  await check('wheel, middle drag, and right drag move viewport', async () => {
    const box = await surface().boundingBox(); assert(box);
    const start = {x: box.x + 700, y: box.y + 160};
    await page.mouse.move(start.x, start.y); let before = await viewport(); await page.mouse.wheel(0, 160);
    await poll(viewport, value => JSON.stringify(value) !== JSON.stringify(before), 'wheel viewport');
    for (const modifier of ['Control', 'Meta']) {
      before = await viewport(); await page.keyboard.down(modifier);
      try { await page.mouse.wheel(0, -160); } finally { await page.keyboard.up(modifier); }
      await poll(viewport, value => Number(value[0]) !== Number(before[0]), `${modifier} wheel zoom`);
    }
    for (const button of ['middle', 'right']) {
      before = await viewport(); await drag(start, {x: start.x + 90, y: start.y + 45}, button);
      await poll(viewport, value => JSON.stringify(value) !== JSON.stringify(before), `${button} pan`);
      assert.equal(await page.getByRole('menu').count(), 0, 'pan must not leave context menu');
    }
    await page.getByTestId('board-zoom-fit-board').click(); return await viewport();
  });
  await check('existing connector, handles, and object toolbar follow live movement', async () => {
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
    const beforeMove = await snapshot();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 70, start.y + 40, {steps: 12});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const liveHandle = await poll(() => handle.boundingBox(), value => value && Math.abs(value.x - beforeHandle.x) > 20, 'live handle translation');
    const liveToolbar = await toolbar.boundingBox(); assert(liveToolbar);
    assert(Math.abs(liveToolbar.x - beforeToolbar.x) > 10 || Math.abs(liveToolbar.y - beforeToolbar.y) > 10, 'object toolbar follows drag before commit');
    const livePixels = await poll(magenta, value => value.count > 20 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 5, 'existing connector pixels follow during drag');
    const measured = {start, canonicalGeometry: beforeMove.objects.find(object => object.id === first.id)?.geometry, beforeScenes, liveScenes: JSON.parse(await surface().getAttribute('data-object-scenes')), beforeHandles, liveHandles: await handlesState(), requestedDelta: {x: 70, y: 40}, actualHandleDelta: {x: liveHandle.x - beforeHandle.x, y: liveHandle.y - beforeHandle.y}, beforeHandle, liveHandle, beforeToolbar, liveToolbar, beforePixels, livePixels, viewport: await viewport()};
    writeFileSync(join(out, 'live-drag-measurements.json'), JSON.stringify(measured, null, 2));
    await page.screenshot({path: join(out, 'live-drag.png')});
    assert(Math.abs(measured.actualHandleDelta.x - 70) <= 8 && Math.abs(measured.actualHandleDelta.y - 40) <= 8, `handle matches live screen displacement: ${JSON.stringify(measured)}`);
    assert.deepEqual((await snapshot()).objects, beforeMove.objects, 'live preview must not commit before pointer release');
    await page.screenshot({path: join(out, 'live-drag.png')}); await page.mouse.up(); await synced();
    const moved = await poll(rows, value => value.find(row => row.id === first.id).geometry.x !== first.geometry.x, 'committed object movement');
    const edgeRow = page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${edgeId}"]`);
    const anchor = JSON.parse(await edgeRow.getAttribute('data-connector-start'));
    const geometry = moved.find(row => row.id === first.id).geometry;
    assert(Math.abs(anchor.x - geometry.x - geometry.width) < 1 && Math.abs(anchor.y - geometry.y - geometry.height / 2) < 1, 'connector remains attached after commit');
    await page.keyboard.press('c'); await clickCanvas(1050, 160); await page.keyboard.press('Escape');
    assert.equal((await rows()).filter(row => row.kind === 'connector').length, 1, 'C shortcut cannot create connectors');
    return {edgeId, beforeHandle, liveHandle, beforeToolbar, liveToolbar, beforePixels, livePixels, anchor};
  });
  await check('drawing changes pixels before pointer release; eraser preserves non-drawings', async () => {
    await page.getByTestId('board-add-draw').click(); const box = await surface().boundingBox(); assert(box);
    const panel = await page.getByTestId('board-draw-tool-panel').boundingBox(); assert(panel && panel.height <= 160, 'compact draw panel height <=160px');
    assert.equal(await page.locator('[data-testid*="draw-opacity"]').count(), 0, 'opacity control removed');
    // Inspect only the pointer stroke region; unrelated selection controls may disappear.
    const pixels = (region, color) => surface().locator('canvas').evaluateAll((canvases, {region, color}) => canvases.reduce((count, canvas) => {
      const bounds = canvas.getBoundingClientRect(), sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
      const x = Math.max(0, Math.floor((region.x - bounds.x) * sx)), y = Math.max(0, Math.floor((region.y - bounds.y) * sy));
      const width = Math.min(canvas.width - x, Math.ceil(region.width * sx)), height = Math.min(canvas.height - y, Math.ceil(region.height * sy));
      const data = canvas.getContext('2d').getImageData(x, y, width, height).data;
      for (let index = 0; index < data.length; index += 4) {
        const matches = color === 'red' ? data[index] > data[index + 1] + 15 && data[index] > data[index + 2] + 15 : Math.max(data[index], data[index + 1], data[index + 2]) < 160;
        if (data[index + 3] > 0 && matches) count++;
      }
      return count;
    }, 0), {region, color});
    const prepareRegion = async (start, dy) => {
      const region = {x: start.x - 14, y: start.y - 14, width: 148, height: dy + 28};
      const reachable = await page.evaluate(points => points.every(point => document.elementFromPoint(point.x, point.y)?.classList.contains('upper-canvas')), [start, {x: start.x + 120, y: start.y + dy}]);
      assert(reachable, 'stroke pointer path must stay inside exposed Fabric canvas');
      await page.mouse.move(start.x, start.y);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return region;
    };
    const start = {x: box.x + 1050, y: box.y + 70};
    const initialRegion = await prepareRegion(start, 30);
    const beforePixels = await pixels(initialRegion, 'black'); const before = await snapshot();
    assert.equal(beforePixels, 0, 'initial stroke region must be blank before drawing');
    await page.mouse.down(); await page.mouse.move(start.x + 120, start.y + 30, {steps: 15});
    await poll(() => surface().getAttribute('data-drawing-preview-segments'), value => Number(value) > 0, 'initial live drawing segments');
    const previewPixels = await poll(() => pixels(initialRegion, 'black'), value => value > beforePixels + 10, 'visible black live stroke pixels in pointer region');
    assert.equal((await snapshot()).objects.filter(value => value.kind === 'drawing').length, before.objects.filter(value => value.kind === 'drawing').length);
    await page.screenshot({path: join(out, 'live-drawing.png')}); await page.mouse.up(); await synced();
    await poll(snapshot, value => value.objects.some(object => object.kind === 'drawing'), 'persisted drawing');
    const styles = [];
    for (const [index, choice] of ['pen', 'marker', 'pencil', 'highlighter'].entries()) {
      await page.getByTestId(`board-draw-${choice}`).click();
      await page.getByTestId('board-draw-color-ef4444').click();
      const drawStart = {x: box.x + 1050, y: box.y + 130 + index * 50};
      const region = await prepareRegion(drawStart, 30);
      const pre = await snapshot(); const preInk = await pixels(region, 'red'); assert.equal(preInk, 0, `${choice} stroke region must begin without red ink`);
      const preIds = new Set(pre.objects.filter(object => object.kind === 'drawing').map(object => object.id));
      await page.mouse.move(drawStart.x, drawStart.y); await page.mouse.down();
      await page.mouse.move(drawStart.x + 120, drawStart.y + 30, {steps: 15});
      await poll(() => surface().getAttribute('data-drawing-preview-segments'), value => Number(value) > 0, `${choice} live preview`);
      const liveInk = await poll(() => pixels(region, 'red'), value => value > preInk + 10, `${choice} actual red preview pixels increase in pointer region`);
      assert.deepEqual((await snapshot()).objects, pre.objects, `${choice} preview must remain uncommitted`);
      await page.screenshot({path: join(out, `draw-${choice}-live.png`)}); await page.mouse.up(); await synced();
      const committed = await poll(snapshot, value => value.objects.some(object => object.kind === 'drawing' && !preIds.has(object.id)), `${choice} persisted drawing`);
      const stroke = committed.objects.find(object => object.kind === 'drawing' && !preIds.has(object.id)).extensionData.contentObject.strokes[0];
      assert.equal(stroke.color.toUpperCase(), '#EF4444'); assert(stroke.width > 0 && stroke.opacity > 0 && stroke.opacity <= 1);
      styles.push({choice, tool: stroke.tool, width: stroke.width, opacity: stroke.opacity, color: stroke.color, region, preInk, liveInk});
    }
    assert.equal(new Set(styles.map(style => `${style.width}:${style.opacity}`)).size, 4, 'four instruments produce distinct actual width/opacity');
    assert.equal(styles.find(style => style.choice === 'pencil').tool, 'pen', 'pencil uses pen geometry with pencil appearance');
    assert(styles.find(style => style.choice === 'highlighter').opacity < styles.find(style => style.choice === 'pen').opacity, 'highlighter is translucent');
    const drawn = await snapshot();
    const preserved = drawn.objects.filter(value => value.kind !== 'drawing');
    await page.getByTestId('board-draw-eraser').click(); await drag(start, {x: start.x + 120, y: start.y + 60});
    await synced(); const erased = await snapshot();
    assert.deepEqual(erased.objects.filter(value => value.kind !== 'drawing'), preserved);
    assert.notDeepEqual(erased.objects.filter(value => value.kind === 'drawing'), drawn.objects.filter(value => value.kind === 'drawing'));
    await page.keyboard.press('Escape'); return {beforePixels, previewPixels, panel, styles};
  });
  await check('image bytes persist through real upload and reload', async () => {
    const bytes = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#E53935'; ctx.fillRect(0, 0, 32, 48); ctx.fillStyle = '#00A86B'; ctx.fillRect(32, 0, 32, 48); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
    await page.getByTestId('board-add-image').click();
    await page.getByTestId('board-image-dialog-input').setInputFiles({name: 'acceptance.png', mimeType: 'image/png', buffer: bytes});
    const persisted = await poll(snapshot, value => value.objects.some(object => object.kind === 'image' && object.extensionData?.contentObject?.persistence === 'durable'), 'durable image');
    const image = persisted.objects.find(object => object.kind === 'image').extensionData.contentObject;
    assert.equal(image.contentDigest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.deepEqual(await (await api('GET', `/whiteboards/${boardId}/assets/${image.assetId}/content`)).body(), bytes);
    await synced(); await page.reload(); await synced();
    assert.deepEqual((await snapshot()).objects, persisted.objects);
    await page.getByTestId('board-zoom-fit-board').click();
    await poll(() => surface().locator('canvas.lower-canvas').evaluate(canvas => {
      const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0, green = 0;
      for (let index = 0; index < values.length; index += 4) {
        if (values[index] === 229 && values[index + 1] === 57 && values[index + 2] === 53) red++;
        if (values[index] === 0 && values[index + 1] === 168 && values[index + 2] === 107) green++;
      }
      return {red, green};
    }), value => value.red > 10 && value.green > 10, 'uploaded image red and green pixels after reload');
    return {assetId: image.assetId, digest: image.contentDigest};
  });
  await check('desktop and narrow screen sync and screenshots', async () => {
    const expected = (await snapshot()).objects;
    await page.getByTestId('board-zoom-fit-board').click(); await page.screenshot({path: join(out, 'desktop.png')});
    await page.setViewportSize({width: 390, height: 844}); await page.reload(); await synced();
    assert.deepEqual((await snapshot()).objects, expected);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal page overflow');
    await page.screenshot({path: join(out, 'narrow-initial.png')});
    await page.getByTestId('board-zoom-fit-board').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path: join(out, 'narrow.png')});
    writeFileSync(join(out, 'canonical.json'), JSON.stringify(await snapshot(), null, 2)); return {objects: expected.length};
  });
  // File-backed boards intentionally reject standard/portable export. Keep this last.
  await check('ordinary file direct drop, durable tile reload, and downloaded bytes', async () => {
    await page.setViewportSize({width: 1440, height: 900});
    const fileName = 'acceptance-file.txt';
    const bytes = Buffer.from(`Board ordinary file acceptance\n${randomUUID()}\n`, 'utf8');
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const before = await rows();
    const uploaded = page.waitForResponse(response => response.url().endsWith(`/whiteboards/${boardId}/files`) && response.request().method() === 'POST');
    const transfer = await page.evaluateHandle(({base64, name}) => {
      const values = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const data = new DataTransfer(); data.items.add(new File([values], name, {type: 'text/plain'})); return data;
    }, {base64: bytes.toString('base64'), name: fileName});
    const box = await surface().boundingBox(); assert(box);
    await surface().dispatchEvent('drop', {dataTransfer: transfer, clientX: box.x + 500, clientY: box.y + 260});
    const response = await uploaded; assert(response.ok(), `file upload status ${response.status()}`);
    const file = await response.json(); assert.equal(file.contentDigest, digest); assert.equal(file.byteSize, bytes.length);
    const after = await poll(rows, value => value.length === before.length + 1 && value.some(row => row.text?.includes(fileName)), 'visible file tile');
    const tile = after.find(row => !before.some(prior => prior.id === row.id)); assert(tile);
    await synced(); await page.reload(); await synced();
    assert((await rows()).some(row => row.id === tile.id && row.text?.includes(fileName)), 'file tile survives reload');
    const content = await api('GET', `/whiteboards/${boardId}/files/${file.assetId}/content`);
    assert.match(content.headers()['content-disposition'], /attachment/i);
    assert(content.headers()['content-disposition'].includes(fileName), 'download header preserves filename');
    assert.deepEqual(await content.body(), bytes);
    await page.getByTestId('board-zoom-fit-board').click(); const center = await point(tile.id);
    await page.mouse.click(center.x, center.y);
    const expand = page.getByTestId('board-inspector-expand'); if (await expand.isVisible()) await expand.click();
    const downloadEvent = page.waitForEvent('download'); await page.getByTestId('board-file-download').click();
    const download = await downloadEvent; assert.equal(download.suggestedFilename(), fileName);
    const downloadPath = join(out, fileName); await download.saveAs(downloadPath); assert.deepEqual(readFileSync(downloadPath), bytes);
    await page.screenshot({path: join(out, 'file-tile-reloaded.png')}); await transfer.dispose();
    return {assetId: file.assetId, contentDigest: digest, tileId: tile.id, filename: fileName};
  });
  completed = true;
} catch (error) {
  if (!results.some(value => !value.ok)) results.push({name: 'setup', ok: false, detail: redact(error.stack ?? error)});
} finally {
  await browser?.close().catch(error => browserErrors.push(redact(error.message)));
  const ok = completed && results.length > 0 && results.every(value => value.ok) && browserErrors.length === 0;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ok, boardId, base, apiOrigin, results, browserErrors}, null, 2));
  writeFileSync(join(out, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board Input UX Acceptance\n\nResult: ${ok ? 'PASS' : 'FAIL'}\n\n${results.map(value => `- ${value.ok ? 'PASS' : 'FAIL'} ${value.name}${value.ok ? '' : `: ${value.detail.split('\n')[0]}`}`).join('\n')}\n\nBrowser errors: ${browserErrors.length} (browser-errors.json)\n`);
  process.exitCode = ok ? 0 : 1;
}
