import {expect, type APIRequestContext, type Page} from '@playwright/test';
import {expectBoardSynced} from './support/board-sync-status';
import {createHash,randomUUID} from 'node:crypto';
import type {WhiteboardCommand, WhiteboardObject} from '@repo/whiteboard-core';
import {rotatedAnchorPoint} from '@repo/whiteboard-core';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {FULLSTACK_E2E} from './fullstack-smoke-fixture';

export {BOARD_SYNCED_STATUS} from './support/board-sync-status';
export const apiOrigin = () => `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
export async function boardLogin(page: Page, email: string = FULLSTACK_E2E.email, password: string = FULLSTACK_E2E.password) {
  await page.goto('/login'); await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password); await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/(?:home|projects)$/);
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy(); return token!;
}
export async function boardApi(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response = await api.fetch(`${apiOrigin()}${path}`, {method, headers: {authorization: `Bearer ${token}`}, data});
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}
/** Human owner/editor canonical read through the authenticated durable standard export API.
 * Agent reads continue to use /objects with their genuinely delegated actorId.
 */
export async function canonicalBoardSnapshot(api: APIRequestContext, token: string, id: string) {
  const exported = await (await boardApi(api, token, 'POST', `/whiteboards/${id}/imports/standard-export`, {requestId: randomUUID()})).json();
  expect(exported.boardId).toBe(id);
  expect(exported.downloadPath).toBe(`/whiteboards/${id}/imports/standard-export/${exported.exportId}`);
  const downloaded = await (await boardApi(api, token, 'GET', exported.downloadPath)).json();
  for (const key of ['format', 'exportId', 'boardId', 'epoch', 'seq', 'sha256', 'sizeBytes', 'objectKey']) {
    expect(downloaded[key], `export/download ${key}`).toEqual(exported[key]);
  }
  expect(typeof downloaded.contentBase64).toBe('string');
  const bytes = Buffer.from(downloaded.contentBase64, 'base64');
  expect(bytes.length).toBe(exported.sizeBytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(exported.sha256);
  const content = JSON.parse(bytes.toString('utf8')) as {format: string; board: {id: string; epoch: number; seq: number}; objects: WhiteboardObject[]};
  expect(content.format).toBe('workspacex.board.v1');
  expect(content.board).toEqual({id, epoch: exported.epoch, seq: exported.seq});
  expect(Array.isArray(content.objects)).toBe(true);
  expect(new Set(content.objects.map(object => object.id)).size).toBe(content.objects.length);
  return {boardId: id, revision: {epoch: content.board.epoch, seq: content.board.seq}, objects: content.objects};
}
export async function createAcceptanceBoard(api: APIRequestContext, token: string, name: string) {
  return (await (await boardApi(api, token, 'POST', '/whiteboards', {requestId: randomUUID(), name})).json() as {id: string}).id;
}
export async function archiveAcceptanceBoard(api: APIRequestContext, token: string, id: string) {
  const current = await (await boardApi(api, token, 'GET', `/whiteboards/${id}`)).json() as {archived: boolean; lifecycleRevision: number};
  if (!current.archived) await boardApi(api, token, 'PATCH', `/whiteboards/${id}`, {archived: true, expectedLifecycleRevision: current.lifecycleRevision});
}
export const provenance = (source: 'human' | 'public-api' | 'ai-proposal') => ({source,
  model: source === 'ai-proposal' ? 'server-resolved' : null, skill: source === 'ai-proposal' ? 'server-resolved' : null,
  sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: []});
export async function boardHead(api: APIRequestContext, token: string, id: string) {
  const value = await (await boardApi(api, token, 'GET', `/v1/whiteboards/${id}/head`)).json() as {epoch: number; seq: number};
  return {epoch: value.epoch, seq: value.seq};
}
export async function operate(api: APIRequestContext, token: string, boardId: string, commands: WhiteboardCommand[], agent = false) {
  const actor = {kind: agent ? 'ai' : 'human', actorId: agent ? FULLSTACK_E2E.agentId : FULLSTACK_E2E.userId,
    orgId: FULLSTACK_E2E.orgId, role: 'owner', scopes: ['board:read', 'board:write'], delegatedBy: agent ? FULLSTACK_E2E.userId : null};
  const response = await boardApi(api, token, 'POST', `/v1/whiteboards/${boardId}/operations`, {
    apiVersion: '2026-09-01', requestId: randomUUID(), boardId, expectedRevision: await boardHead(api, token, boardId),
    actor, commands, provenance: provenance(agent ? 'public-api' : 'human'),
  });
  const receipt = await response.json() as {revision: {epoch: number; seq: number}; events: Array<{actor: {kind: string; actorId: string}; objectIds: string[]}>};
  expect(receipt.events.length).toBeGreaterThan(0);
  if (agent) for (const event of receipt.events) expect(event.actor).toMatchObject({kind: 'ai', actorId: FULLSTACK_E2E.agentId});
  return receipt;
}
export type Geometry = WhiteboardObject['geometry'];
export function object(id: string, kind: WhiteboardObject['kind'], x: number, y: number, text = id, width = 180, height = 180): WhiteboardObject {
  return {id, schemaVersion: 1, kind, geometry: {x, y, width, height, rotation: 0}, text,
    style: {fill: '#F8D76E'}, parentId: null, orderKey: id};
}
export const createCommands = (objects: WhiteboardObject[]): WhiteboardCommand[] => objects.map(value => ({type: 'create', object: value}));
export type CanonicalRow = {id: string; kind: string; text: string; geometry: Geometry; parentId: string;
  from: string; to: string; start: {x: number; y: number} | null; end: {x: number; y: number} | null};
export async function canonicalRows(page: Page): Promise<CanonicalRow[]> {
  return page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').evaluateAll(rows => rows.map(element => {
    const row = element as HTMLElement;
    return {id: row.dataset.objectId!, kind: row.dataset.objectKind!, text: row.dataset.objectText ?? '',
      geometry: JSON.parse(row.dataset.geometry!), parentId: row.dataset.parentId ?? '',
      from: row.dataset.connectorFrom ?? '', to: row.dataset.connectorTo ?? '',
      start: row.dataset.connectorStart ? JSON.parse(row.dataset.connectorStart) : null,
      end: row.dataset.connectorEnd ? JSON.parse(row.dataset.connectorEnd) : null};
  }).sort((a, b) => a.id.localeCompare(b.id)));
}
export async function openBoard(page: Page, id: string, count: number) {
  await page.goto(`/studio/board/${id}`);
  await expectBoardSynced(page,30_000);
  await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(count);
}
export async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
export async function selectAll(page: Page, count: number) {
  await page.getByTestId('board-tool-select').click();
  await page.getByTestId('board-tool-select').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText(`已选择 ${count} 个对象`);
}
/** Read-only projection coordinates. Input still uses real Playwright mouse events. */
export async function objectPoint(page: Page, id: string, header = false) {
  await settled(page);
  const surface = page.getByTestId('board-fabric-surface'), box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const scenes = JSON.parse((await surface.getAttribute('data-object-scenes')) ?? '[]') as Array<{id: string; left: number; top: number; width: number; height: number}>;
  const scene = scenes.find(value => value.id === id); expect(scene, `Fabric projection for ${id}`).toBeTruthy();
  const zoom = Number(await surface.getAttribute('data-viewport-zoom'));
  const panX = Number(await surface.getAttribute('data-viewport-pan-x')), panY = Number(await surface.getAttribute('data-viewport-pan-y'));
  const fractions: Array<readonly [number, number]> = header ? [[0.5, 10], [0.25, 10], [0.75, 10]] :
    [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]];
  const points = fractions.map(([fx, fy]) => ({
    x: box!.x + panX + (scene!.left + scene!.width * fx) * zoom,
    y: box!.y + panY + (scene!.top + (header ? fy : scene!.height * fy)) * zoom,
  }));
  const point = await page.evaluate(candidates => candidates.find(candidate =>
    (document.elementFromPoint(candidate.x, candidate.y) as HTMLElement | null)?.dataset.fabric === 'top') ?? null, points);
  expect(point, `Object ${id} must expose a Fabric hit point outside overlays`).not.toBeNull();
  return {...point!, zoom};
}
async function surfaceSnapshot(page: Page, x: number, y: number) {
  return page.getByTestId('board-fabric-surface').evaluate((surface, point) => {
    const target = document.elementFromPoint(point.x, point.y);
    return {target: target?.tagName, testId: (target as HTMLElement | null)?.dataset.testid, fabric: (target as HTMLElement | null)?.dataset.fabric, zoom: surface.getAttribute('data-viewport-zoom'), panX: surface.getAttribute('data-viewport-pan-x'), panY: surface.getAttribute('data-viewport-pan-y'), scenes: surface.getAttribute('data-object-scenes'), selected: Array.from(surface.querySelectorAll('[aria-pressed="true"]')).map(element => (element as HTMLElement).dataset.testid)};
  }, {x,y});
}
export async function dragObject(page: Page, id: string, dx: number, dy: number, header = false, expectedParentId?: string, maxSceneError = 1) {
  await page.keyboard.press('Escape'); await page.getByTestId('board-tool-select').click();
  await page.getByTestId('board-zoom-fit-board').click();
  const before = (await canonicalRows(page)).find(row => row.id === id)!;
  const point = await objectPoint(page, id, header);
  const diagnosticsEnabled = process.env.BOARD_DRAG_DIAGNOSTIC === '1';
  const diagnostic = async (phase: string) => {
    const projection = await surfaceSnapshot(page, point.x, point.y);
    console.log('BOARD_DRAG_DIAGNOSTIC', JSON.stringify({id, phase, point, dx, dy, projection, rows: await canonicalRows(page)}));
  };
  if (diagnosticsEnabled) await diagnostic('before');
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  if (diagnosticsEnabled) await diagnostic('down');
  await page.mouse.move(point.x + dx * point.zoom, point.y + dy * point.zoom, {steps: 12});
  if (diagnosticsEnabled) await diagnostic('moved');
  await page.mouse.up();
  if (diagnosticsEnabled) await diagnostic('up');
  // Reparenting is center-hit based and an auto-expanding panel may move its
  // own bounds while accepting the child. parentId is the canonical outcome;
  // the pre-drop absolute target is not stable across that container update.
  if (expectedParentId !== undefined) {
    await expect.poll(async () => (await canonicalRows(page)).find(row => row.id === id)?.parentId).toBe(expectedParentId);
    return;
  }
  // Fabric converts between viewport and scene coordinates while dragging.
  // Browser engines can leave a sub-pixel remainder. Callers exercising grid
  // snapping may explicitly allow one four-pixel grid step.
  await expect.poll(async () => {
    const geometry = (await canonicalRows(page)).find(row => row.id === id)?.geometry;
    if (!geometry) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(geometry.x - before.geometry.x - dx), Math.abs(geometry.y - before.geometry.y - dy));
  }).toBeLessThanOrEqual(maxSceneError);
}
export function gridValid(rows: CanonicalRow[], columns = 3, gap = 24) {
  const sorted = [...rows].sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
  if (sorted.length < 2) return false;
  const first = sorted[0]!.geometry;
  return sorted.every((row, index) => Math.abs(row.geometry.x - (first.x + index % columns * (first.width + gap))) <= 1
    && Math.abs(row.geometry.y - (first.y + Math.floor(index / columns) * (first.height + gap))) <= 1);
}
export async function connectByHandles(page: Page, from: string, to: string) {
  await page.keyboard.press('Escape'); await page.getByTestId('board-tool-select').click();
  await page.getByTestId('board-zoom-fit-board').click();
  const boardId = new URL(page.url()).pathname.split('/').at(-1)!;
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();
  const expectedRows = await canonicalRows(page);
  const expectedIds = expectedRows.map(object => object.id).sort();
  expect(expectedIds).toContain(from); expect(expectedIds).toContain(to);
  await expectBoardSynced(page,30_000);
  await expect.poll(async () => {
    const persisted = await canonicalBoardSnapshot(page.request, token!, boardId);
    return persisted.objects.map(object => ({id:object.id,text:object.text,geometry:object.geometry,parentId:object.parentId??''})).sort((a,b)=>a.id.localeCompare(b.id));
  }, {timeout: 30_000, message: 'local object content and geometry must be durably acknowledged before connecting'}).toEqual(expectedRows.map(({id,text,geometry,parentId})=>({id,text,geometry,parentId})));
  await expect.poll(() => canonicalRows(page)).toEqual(expectedRows);
  const before = await canonicalBoardSnapshot(page.request, token!, boardId);
  expect(before.objects.map(object => object.id).sort()).toEqual(expectedIds);
  expect(before.objects.map(object => ({id:object.id,text:object.text,geometry:object.geometry,parentId:object.parentId??''})).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expectedRows.map(({id,text,geometry,parentId})=>({id,text,geometry,parentId})));
  const blankSurface = page.getByTestId('board-fabric-surface');
  const blank = await blankSurface.evaluate(element => {
    const box = element.getBoundingClientRect();
    const scenes = JSON.parse(element.getAttribute('data-object-scenes') ?? '[]') as Array<{left: number; top: number; width: number; height: number}>;
    const zoom = Number(element.getAttribute('data-viewport-zoom'));
    const panX = Number(element.getAttribute('data-viewport-pan-x'));
    const panY = Number(element.getAttribute('data-viewport-pan-y'));
    for (let y = 24; y < box.height - 24; y += 48) for (let x = 24; x < box.width - 24; x += 48) {
      const point = {x: box.x + x, y: box.y + y};
      if ((document.elementFromPoint(point.x, point.y) as HTMLElement | null)?.dataset.fabric !== 'top') continue;
      if (scenes.some(scene => x >= panX + scene.left * zoom - 24 && x <= panX + (scene.left + scene.width) * zoom + 24
        && y >= panY + scene.top * zoom - 24 && y <= panY + (scene.top + scene.height) * zoom + 24)) continue;
      return point;
    }
    return null;
  });
  expect(blank, 'A real empty canvas hit must clear the previous multi-selection').not.toBeNull();
  await page.mouse.click(blank!.x, blank!.y);
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');
  const sourceOutline = page.getByTestId(`board-a11y-object-${from}`);
  await sourceOutline.focus(); await sourceOutline.press('Enter');
  const editor = page.getByTestId('board-thinking-editor');
  if (await editor.count()) await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(sourceOutline).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 1 个对象');
  await expect(page.getByTestId('board-a11y-mirror').locator('button[aria-pressed="true"]')).toHaveCount(1);
  const source = await objectPoint(page, from);
  await page.mouse.move(source.x, source.y);
  const sourceHandle = page.getByTestId(`connector-handle-${from}-right`);
  await expect(sourceHandle).toBeVisible();
  const sourceBounds = await sourceHandle.boundingBox(); expect(sourceBounds).not.toBeNull();
  const target = before.objects.find(object => object.id === to)!; expect(target).toBeTruthy();
  const anchor = rotatedAnchorPoint(target, 'left');
  const surface = page.getByTestId('board-fabric-surface'), bounds = await surface.boundingBox(); expect(bounds).not.toBeNull();
  const zoom = Number(await surface.getAttribute('data-viewport-zoom'));
  const destination = {x: bounds!.x + Number(await surface.getAttribute('data-viewport-pan-x')) + anchor.x * zoom,
    y: bounds!.y + Number(await surface.getAttribute('data-viewport-pan-y')) + anchor.y * zoom};
  await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, {steps: 12});
  await expect(page.getByTestId('board-connector-snap-cue')).toHaveAttribute('data-target-id', to);
  expect(await canonicalBoardSnapshot(page.request, token!, boardId)).toEqual(before);
  await page.mouse.up();
  await expect.poll(async () => (await canonicalRows(page)).filter(row => row.kind === 'connector' && row.from === from && row.to === to).length).toBe(1);
  await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => boardHead(page.request, token!, boardId)).toEqual({epoch: before.revision.epoch, seq: before.revision.seq + 1});
  const after = await canonicalBoardSnapshot(page.request, token!, boardId);
  expect(after.objects).toHaveLength(before.objects.length + 1);
  expect(after.objects.filter(object => object.kind === 'connector' && object.connector?.from === from && object.connector?.to === to)).toHaveLength(1);
  await page.reload(); await expectBoardSynced(page,30_000);
  expect(await canonicalBoardSnapshot(page.request, token!, boardId)).toEqual(after);
  return 1;
}
export function connectorsBound(rows: CanonicalRow[]) {
  return rows.filter(row => row.kind === 'connector').every(edge => {
    const from = rows.find(row => row.id === edge.from), to = rows.find(row => row.id === edge.to);
    return !!from && !!to && !!edge.start && !!edge.end
      && Math.abs(edge.start.x - from.geometry.x - from.geometry.width) <= 1
      && Math.abs(edge.start.y - from.geometry.y - from.geometry.height / 2) <= 1
      && Math.abs(edge.end.x - to.geometry.x) <= 1
      && Math.abs(edge.end.y - to.geometry.y - to.geometry.height / 2) <= 1;
  });
}
export async function assertReload(page: Page, boardId: string, expected: CanonicalRow[]) {
  await openBoard(page, boardId, expected.length);
  await expect.poll(() => canonicalRows(page)).toEqual(expected);
}

/** Existing Frame fixture uses the real authenticated command API; creation is absent from the dock. */
export async function seedExistingFrame(page: Page, x: number, y: number, width = 480, height = 320) {
  const token = await page.evaluate(key => localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();
  const boardId = new URL(page.url()).pathname.split('/').at(-1)!;
  const id = `existing-frame-${randomUUID()}`;
  await boardApi(page.request, token!, 'POST', `/whiteboards/${boardId}/commands`, {
    requestId: randomUUID(), epoch: 1, commands: createCommands([{...object(id, 'frame', x, y, 'Existing Frame', width, height), extensionData: {spatial: {version: 1, mode: 'freeform', autoExpand: false, clipContent: false, padding: 24, gap: 24, columns: 3, flowDirection: 'horizontal'}}}]),
  });
  await expect(page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${id}"]`)).toBeVisible();
  return id;
}
