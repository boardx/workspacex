#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Existing local stack and explicitly supplied authenticated browser state only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (key, fallback) => process.argv.includes(`--${key}`) ? process.argv[process.argv.indexOf(`--${key}`) + 1] : fallback;
const state = arg('storage-state', null);
assert(state, '--storage-state is required; this script does not log in');
const base = arg('base', 'http://127.0.0.1:3317');
const origin = arg('api', 'http://127.0.0.1:3320');
const out = resolve(arg('out', '/private/tmp/wsx-canvas-transform-evidence'));
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
createRequire(join(root, 'package.json'))('tsx/esm/api').register();
const { WhiteboardOperationRequest } = await import('../../packages/contracts/src/whiteboard-operation.ts');
const { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, rotatedAnchorPoint } = await import('../../packages/whiteboard-core/src/index.ts');
const { BOARD_FABRIC_VISUAL } = await import('../../apps/web/components/whiteboard/fabric/board-fabric-visual.ts');
mkdirSync(out, { recursive: true });
let browser, page, token, boardId;
const results = [];
const browserErrors = [];
const poll = async (read, predicate, label) => {
  const until = Date.now() + 30000;
  do { const value = await read(); if (predicate(value)) return value; await new Promise(done => setTimeout(done, 100)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
};
const api = async (method, path, body) => {
  const response = await page.request.fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token}` }, data: body });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response;
};
const snapshot = async () => {
  const exported = await (await api('POST', `/whiteboards/${boardId}/imports/standard-export`, { requestId: randomUUID() })).json();
  const file = await (await api('GET', exported.downloadPath)).json();
  return JSON.parse(Buffer.from(file.contentBase64, 'base64').toString('utf8'));
};
const synced = () => poll(() => page.getByTestId('board-sync-status').getAttribute('data-sync-state'), value => value === 'saved', 'saved');
const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const screen = async point => {
  const surface = page.getByTestId('board-fabric-surface'), box = await surface.boundingBox(); assert(box);
  const [zoom, x, y] = await Promise.all(['zoom', 'pan-x', 'pan-y'].map(key => surface.getAttribute(`data-viewport-${key}`)));
  return { x: box.x + Number(x) + point.x * Number(zoom), y: box.y + Number(y) + point.y * Number(zoom) };
};
const center = object => {
  const angle = object.geometry.rotation * Math.PI / 180, x = object.geometry.width / 2, y = object.geometry.height / 2;
  return { x: object.geometry.x + x * Math.cos(angle) - y * Math.sin(angle), y: object.geometry.y + x * Math.sin(angle) + y * Math.cos(angle) };
};
const check = async (name, run) => {
  const detail = await run(); results.push({ name, ok: true, detail }); console.log('PASS', name);
};
const edgePixels = () => page.getByTestId('board-fabric-surface').locator('canvas.lower-canvas').evaluate(canvas => {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0, x = 0, y = 0;
  for (let index = 0; index < data.length; index += 4) if (data[index] > 150 && data[index + 1] < 80 && data[index + 2] > 180) { count++; x += (index / 4) % canvas.width; y += Math.floor(index / 4 / canvas.width); }
  return { count, x: x / count, y: y / count };
});
const fabricObservation = () => page.getByTestId('board-fabric-surface').evaluate(element => {
  let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
  while (fiber) {
    let hook = fiber.memoizedState;
    while (hook && typeof hook === 'object') {
      const canvas = hook.memoizedState?.current;
      if (canvas && typeof canvas.getObjects === 'function' && typeof canvas.getActiveObject === 'function') {
        const active = canvas.getActiveObject(), box = element.getBoundingClientRect();
        if (!active) return null;
        const middle = active.getCenterPoint(), v = canvas.viewportTransform, mtr = active.oCoords?.mtr;
        return { geometry: { left: active.left, top: active.top, width: active.width, height: active.height, scaleX: active.scaleX, scaleY: active.scaleY, angle: active.angle }, layout: active.layoutManager?.strategy?.constructor?.type, center: { x: box.x + middle.x * v[0] + v[4], y: box.y + middle.y * v[3] + v[5] }, mtr: mtr ? { x: box.x + mtr.x, y: box.y + mtr.y } : null };
      }
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
});
try {
  browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
  const storage = JSON.parse(readFileSync(resolve(state), 'utf8'));
  const storedOrigin = storage.origins.find(item => item.origin === new URL(base).origin); assert(storedOrigin, 'supplied state must match browser origin');
  const local = new Map(storedOrigin.localStorage.map(item => [item.name, item.value]));
  token = local.get('wsx.sessionToken'); assert(token, 'supplied state must contain session token');
  const session = JSON.parse(local.get('wsx.session')); assert(Date.parse(session.expiresAt) > Date.now(), 'supplied session must be unexpired');
  if (session.version === 2) assert.equal(local.get('wsx.sessionCommit'), session.revision, 'version 2 session must be atomically committed');
  page = await browser.newPage({ storageState: storage, viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => browserErrors.push({ source: 'pageerror', message: error.message.replaceAll(token, '[token]') }));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push({ source: 'console', message: message.text().replaceAll(token, '[token]') }); });
  const identity = await (await api('GET', `/identity/me?orgId=${encodeURIComponent(session.currentOrgId)}`)).json();
  assert(identity.orgRole, 'authenticated organization membership');
  boardId = (await (await api('POST', '/whiteboards', { requestId: randomUUID(), name: `Canvas transform acceptance ${randomUUID()}` })).json()).id;
  const make = (id, kind, geometry, extensionData = {}) => ({ id, schemaVersion: 1, kind, geometry, text: kind === 'rectangle' ? 'Transform target' : '', style: { fill: '#FFFFFF', stroke: '#333333', color: '#242424' }, parentId: null, orderKey: id, locked: false, hidden: false, zIndex: 0, extensionData });
  const a = randomUUID(), b = randomUUID(), da = randomUUID(), db = randomUUID(), edge = randomUUID();
  const ink = () => ({ version: 1, type: 'drawing', strokes: [{ id: randomUUID(), tool: 'marker', points: [{ x: 0, y: 0, pressure: .5 }, { x: 100, y: 100, pressure: .5 }], color: '#2563EB', width: 8, opacity: .9 }] });
  const seeds = [
    make(a, 'rectangle', { x: 180, y: 180, width: 140, height: 100, rotation: 0 }),
    make(b, 'rectangle', { x: 390, y: 180, width: 140, height: 100, rotation: 0 }),
    make(da, 'drawing', { x: 560, y: 330, width: 160, height: 160, rotation: 30 }, { contentObject: ink() }),
    make(db, 'drawing', { x: 840, y: 330, width: 140, height: 140, rotation: -25 }, { contentObject: ink() }),
  ];
  const doc = createWhiteboardDocument(); executeCommands(doc, seeds.map(object => ({ type: 'create', object })));
  new SpatialRelationshipCommandPort(doc).dispatch({ boardId, clientId: 'canvas-transform-acceptance', gestureId: randomUUID(), command: { type: 'create-connector', id: edge, relationship: { from: a, to: b, fromAnchor: 'right', toAnchor: 'left', fromOffset: { x: 8, y: 11 }, toOffset: { x: -6, y: 9 }, type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' } } });
  executeCommands(doc, [{ type: 'style', id: edge, style: { stroke: '#CC00FF' } }]);
  const canonical = readObjects(doc); doc.destroy();
  const head = await (await api('GET', `/v1/whiteboards/${boardId}/head`)).json();
  await api('POST', `/v1/whiteboards/${boardId}/operations`, WhiteboardOperationRequest.parse({ apiVersion: '2026-09-01', requestId: randomUUID(), boardId, expectedRevision: { epoch: head.epoch, seq: head.seq }, actor: { kind: 'human', actorId: session.userId, orgId: session.currentOrgId, role: head.role, scopes: ['board:read', 'board:write'], delegatedBy: null }, provenance: { source: 'human', model: null, skill: null, sourceRevision: null, sourceArtifactId: null, layoutHash: null, inputObjectIds: [] }, commands: canonical.map(object => ({ type: 'create', object })) }));
  await page.goto(`${base}/studio/board/${boardId}`); await synced(); await page.getByTestId('board-zoom-fit-board').click(); await settle();
  const assertEndpoints = async objects => {
    const row = page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${edge}"]`);
    for (const [id, anchor, offset, attr] of [[a, 'right', { x: 8, y: 11 }, 'start'], [b, 'left', { x: -6, y: 9 }, 'end']]) {
      const actual = JSON.parse(await row.getAttribute(`data-connector-${attr}`));
      const expected = rotatedAnchorPoint(objects.find(item => item.id === id), anchor, offset);
      assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < .001, `committed ${attr} retains rotated local endpoint offset`);
    }
  };
  await check('real Fabric rotation commits once', async () => {
    const before = await snapshot(), object = before.objects.find(item => item.id === a);
    let c = await screen(center(object));
    await page.mouse.click(c.x, c.y); await settle();
    const beforePixels = await poll(edgePixels, value => value.count > 10, 'offset connector rendered');
    const control = BOARD_FABRIC_VISUAL.rotationControl;
    const anchor = await screen({ x: object.geometry.x + (control.x + .5) * object.geometry.width, y: object.geometry.y + (control.y + .5) * object.geometry.height });
    const observed = await fabricObservation();
    writeFileSync(join(out, 'rotation-initial.json'), JSON.stringify({ canonical: object.geometry, expectedCenter: c, expectedControl: { x: anchor.x + control.offsetX, y: anchor.y + control.offsetY }, observed }, null, 2));
    assert(observed?.mtr, 'read actual Fabric rotation control coordinates');
    c = observed.center;
    const start = observed.mtr;
    const hit = await page.evaluate(point => { const element = document.elementFromPoint(point.x, point.y); return Boolean(element?.classList.contains('upper-canvas')); }, start);
    assert(hit, 'real rotation control must be reachable on Fabric canvas, outside DOM toolbar');
    const dx = start.x - c.x, dy = start.y - c.y, radians = Math.PI / 4;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(c.x + dx * Math.cos(radians) - dy * Math.sin(radians), c.y + dx * Math.sin(radians) + dy * Math.cos(radians), { steps: 12 });
    await poll(edgePixels, value => value.count > 10 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 5, 'offset connector follows live rotation');
    assert.deepEqual((await snapshot()).objects, before.objects, 'rotation preview cannot persist');
    await page.screenshot({ path: join(out, 'rotation-live.png') }); await page.mouse.up(); await synced();
    const after = await poll(snapshot, value => Math.abs(value.objects.find(item => item.id === a).geometry.rotation) > 10, 'rotation commit');
    assert.equal(after.board.seq, before.board.seq + 1, 'one rotation transaction');
    writeFileSync(join(out, 'rotation-measurements.json'), JSON.stringify({ canonicalBefore: object.geometry, canonicalAfter: after.objects.find(item => item.id === a).geometry, center: c, control: start, desiredAngle: 45, pointerEnd: { x: c.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: c.y + dx * Math.sin(radians) + dy * Math.cos(radians) } }, null, 2));
    assert(Math.abs(after.objects.find(item => item.id === a).geometry.rotation - 45) <= 5, 'rotation control reaches intended angle');
    await assertEndpoints(after.objects);
    return { before: object.geometry, after: after.objects.find(item => item.id === a).geometry };
  });
  await check('multi-selection moves two actual objects in one transaction', async () => {
    const before = await snapshot(), selected = before.objects.filter(item => item.id === a || item.id === b);
    await page.mouse.click(1100, 160);
    for (const [index, object] of selected.entries()) {
      const point = await screen(center(object));
      if (index) await page.keyboard.down('Shift');
      await page.mouse.click(point.x, point.y);
      if (index) await page.keyboard.up('Shift');
    }
    const start = await screen(center(selected[0]));
    const beforePixels = await edgePixels();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 55, start.y + 35, { steps: 12 });
    assert.deepEqual((await snapshot()).objects, before.objects, 'multi preview cannot persist');
    await poll(edgePixels, value => value.count > 10 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 5, 'offset connector follows live multi move');
    await page.screenshot({ path: join(out, 'multi-live.png') }); await page.mouse.up(); await synced();
    const after = await poll(snapshot, value => selected.every(item => value.objects.find(next => next.id === item.id).geometry.x !== item.geometry.x), 'multi commit');
    assert.equal(after.board.seq, before.board.seq + 1, 'one multi transaction');
    const deltas = selected.map(item => { const next = after.objects.find(value => value.id === item.id).geometry; assert(Math.abs(next.width - item.geometry.width) < .001 && Math.abs(next.height - item.geometry.height) < .001 && Math.abs(next.rotation - item.geometry.rotation) < .001, 'multi move retains dimensions and rotation'); return { x: next.x - item.geometry.x, y: next.y - item.geometry.y }; });
    assert(Math.abs(deltas[0].x - deltas[1].x) < .001 && Math.abs(deltas[0].y - deltas[1].y) < .001, 'multi members share one translation');
    const zoom = Number(await page.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom'));
    assert(Math.abs(deltas[0].x * zoom - 55) <= 6 && Math.abs(deltas[0].y * zoom - 35) <= 6, 'multi translation matches actual pointer displacement within snap radius');
    await assertEndpoints(after.objects);
    return selected.map(item => ({ id: item.id, before: item.geometry, after: after.objects.find(next => next.id === item.id).geometry }));
  });
  await check('native pointer cancellation restores projection without persistence', async () => {
    await page.mouse.click(1100, 160); const before = await snapshot(), object = before.objects.find(item => item.id === b), start = await screen(center(object));
    await page.mouse.click(start.x, start.y); await settle();
    const handle = page.getByTestId(`connector-handle-${b}-right`), originalHandle = await handle.boundingBox(); assert(originalHandle);
    const beforeViewport = await page.getByTestId('board-fabric-surface').evaluate(element => ({ zoom: element.dataset.viewportZoom, x: element.dataset.viewportPanX, y: element.dataset.viewportPanY }));
    const beforePixels = await edgePixels();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 45, start.y + 30, { steps: 8 }); await settle();
    const movedHandle = await handle.boundingBox(); assert(movedHandle && movedHandle.x - originalHandle.x > 20, 'cancel test must first project an actual drag');
    await poll(edgePixels, value => value.count > 10 && Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) > 5, 'offset connector follows before cancellation');
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true })));
    await page.mouse.up(); await settle(); await synced(); assert.deepEqual((await snapshot()).objects, before.objects);
    const restoredHandle = await handle.boundingBox(); assert(restoredHandle);
    const afterViewport = await page.getByTestId('board-fabric-surface').evaluate(element => ({ zoom: element.dataset.viewportZoom, x: element.dataset.viewportPanX, y: element.dataset.viewportPanY }));
    writeFileSync(join(out, 'cancel-measurements.json'), JSON.stringify({ canonical: object.geometry, originalHandle, movedHandle, restoredHandle, beforeViewport, afterViewport, fabric: await fabricObservation() }, null, 2));
    assert(Math.abs(restoredHandle.x - originalHandle.x) < 1 && Math.abs(restoredHandle.y - originalHandle.y) < 1, 'cancel restores live selection geometry');
    await poll(edgePixels, value => Math.hypot(value.x - beforePixels.x, value.y - beforePixels.y) < 1, 'cancel restores offset connector pixels');
    await assertEndpoints(before.objects);
    const scenes = JSON.parse(await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes')), scene = scenes.find(item => item.id === b); assert(scene);
    await page.screenshot({ path: join(out, 'cancel-restored.png') }); return { id: b, canonical: object.geometry, scene };
  });
  await check('one eraser stroke modifies two rotated scaled drawings and one undo redo restores both', async () => {
    await page.getByTestId('board-add-draw').click(); await page.getByTestId('board-draw-eraser').click();
    const before = await snapshot(), drawings = before.objects.filter(item => item.id === da || item.id === db), p = await screen(center(drawings[0])), q = await screen(center(drawings[1]));
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 24 }); await page.mouse.up(); await synced();
    const after = await poll(snapshot, value => drawings.every(item => value.objects.find(next => next.id === item.id).extensionData.contentObject.strokes.length === 2), 'both drawings erased');
    assert.deepEqual(after.objects.filter(item => item.kind !== 'drawing'), before.objects.filter(item => item.kind !== 'drawing'), 'eraser preserves other kinds');
    assert.equal(after.board.seq, before.board.seq + 1, 'two masks in one transaction');
    await page.screenshot({ path: join(out, 'two-drawings-erased.png') });
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '撤销', exact: true }).click(); await synced();
    const undone = await poll(snapshot, value => drawings.every(item => value.objects.find(next => next.id === item.id).extensionData.contentObject.strokes.length === 1), 'single undo restores both');
    for (const item of drawings) assert.deepEqual(undone.objects.find(next => next.id === item.id), item);
    await page.getByRole('button', { name: '重做', exact: true }).click(); await synced();
    const redone = await poll(snapshot, value => drawings.every(item => value.objects.find(next => next.id === item.id).extensionData.contentObject.strokes.length === 2), 'single redo restores both masks');
    for (const item of drawings) assert.deepEqual(redone.objects.find(next => next.id === item.id), after.objects.find(next => next.id === item.id));
    await page.screenshot({ path: join(out, 'two-drawings-redone.png') }); return { ids: drawings.map(item => item.id), seq: [before.board.seq, after.board.seq, undone.board.seq, redone.board.seq] };
  });
} catch (error) {
  results.push({ name: 'execution', ok: false, detail: String(error.stack ?? error).replaceAll(token ?? '\0', '[token]') });
  await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
} finally {
  await browser?.close();
  const ok = results.length === 4 && results.every(item => item.ok) && browserErrors.length === 0;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ ok, boardId, base, api: origin, browserErrors, results }, null, 2));
  writeFileSync(join(out, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
  process.exitCode = ok ? 0 : 1;
}
