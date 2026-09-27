import {expect, type APIRequestContext, type Page} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import type {WhiteboardCommand, WhiteboardObject} from '@repo/whiteboard-core';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {FULLSTACK_E2E} from './fullstack-smoke-fixture';

export const BOARD_SYNCED_STATUS = /^已同步(?: · 序列 \d+)?$/;
export const apiOrigin = () => `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
export async function boardLogin(page: Page, email: string = FULLSTACK_E2E.email, password: string = FULLSTACK_E2E.password) {
  await page.goto('/login'); await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password); await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/);
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
    return {id: row.dataset.objectId!, kind: row.dataset.objectKind!, text: row.querySelector('button')?.textContent ?? '',
      geometry: JSON.parse(row.dataset.geometry!), parentId: row.dataset.parentId ?? '',
      from: row.dataset.connectorFrom ?? '', to: row.dataset.connectorTo ?? '',
      start: row.dataset.connectorStart ? JSON.parse(row.dataset.connectorStart) : null,
      end: row.dataset.connectorEnd ? JSON.parse(row.dataset.connectorEnd) : null};
  }).sort((a, b) => a.id.localeCompare(b.id)));
}
export async function openBoard(page: Page, id: string, count: number) {
  await page.goto(`/studio/board/${id}`);
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({timeout: 30_000});
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
  const point = {x: box!.x + panX + (scene!.left + scene!.width / 2) * zoom,
    y: box!.y + panY + (scene!.top + (header ? 10 : scene!.height / 2)) * zoom};
  const hit = await page.evaluate(p => (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.dataset.fabric, point);
  expect(hit, `Object ${id} must be reachable without a toolbar covering it`).toBe('top');
  return {...point, zoom};
}
export async function dragObject(page: Page, id: string, dx: number, dy: number, header = false) {
  await page.keyboard.press('Escape'); await page.getByTestId('board-tool-select').click();
  await page.getByTestId('board-zoom-fit-board').click();
  const before = (await canonicalRows(page)).find(row => row.id === id)!;
  const point = await objectPoint(page, id, header);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + dx * point.zoom, point.y + dy * point.zoom, {steps: 12}); await page.mouse.up();
  await expect.poll(async () => (await canonicalRows(page)).find(row => row.id === id)?.geometry).toMatchObject({x: before.geometry.x + dx, y: before.geometry.y + dy});
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
  const source = await objectPoint(page, from); await page.mouse.move(source.x, source.y);
  // Two user clicks: hover exposes connection handles without an extra selection click.
  let clicks = 0;
  await page.getByTestId(`connector-handle-${from}-right`).click(); clicks++;
  const target = await objectPoint(page, to); await page.mouse.move(target.x, target.y);
  await page.getByTestId(`connector-handle-${to}-left`).click(); clicks++;
  await expect.poll(async () => (await canonicalRows(page)).filter(row => row.kind === 'connector' && row.from === from && row.to === to).length).toBe(1);
  return clicks;
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
