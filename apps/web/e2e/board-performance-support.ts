import {performance} from 'node:perf_hooks';
import type {APIRequestContext, Page} from '@playwright/test';
import {expect} from '@playwright/test';
import type {WhiteboardObject} from '@repo/whiteboard-core';
import {canonicalBoardSnapshot, boardApi, boardHead, createCommands, object, operate} from './board-acceptance-support';
import {sha256} from './board-runtime-evidence';

export async function canonicalSnapshot(api: APIRequestContext, token: string, id: string) {
  return canonicalBoardSnapshot(api, token, id);
}
export function mixedDataset(count: number, uploadedImage: WhiteboardObject): WhiteboardObject[] {
  if (![1000, 5000, 10000].includes(count) || uploadedImage.kind !== 'image') throw new Error('INVALID_PERFORMANCE_DATASET');
  return Array.from({length: count}, (_, index) => {
    const local = index % 100, block = Math.floor(index / 100);
    const x = (block % 10) * 2600 + (local % 10) * 230 + 120;
    const y = Math.floor(block / 10) * 2600 + Math.floor(local / 10) * 230 + 160;
    const id = `perf-${String(index).padStart(5, '0')}`;
    if (local < 60) return object(id, 'sticky', x, y, `Research insight ${index}: a real editable note`);
    if (local < 70) return {...object(id, 'connector', x, y, `relates ${index}`, 1, 1), connector: {
      from: `perf-${String(block * 100 + local - 60).padStart(5, '0')}`,
      to: `perf-${String(block * 100 + local - 59).padStart(5, '0')}`,
      fromAnchor: 'right' as const, toAnchor: 'left' as const, type: 'straight' as const, endStyle: 'arrow' as const,
    }};
    if (local < 80) return object(id, 'text', x, y, `Research heading ${index}`, 200, 96);
    if (local < 85) return object(id, 'rectangle', x, y, `Process ${index}`, 200, 140);
    if (local < 90) return {...object(id, 'frame', x, y, `Research area ${index}`, 420, 300), extensionData: {
      spatial: {version: 1, mode: 'freeform', autoExpand: true, clipContent: false, padding: 24, gap: 24, columns: 3, flowDirection: 'horizontal'},
    }};
    if (local < 95) return {...uploadedImage, id: index === 90 ? uploadedImage.id : id,
      geometry: {x, y, width: 180, height: 135, rotation: 0}, orderKey: id, parentId: null};
    const title = `Interview artifact ${index}`;
    return {...object(id, 'extension', x, y, title, 200, 180), extensionData: {contentObject: {
      version: 1, type: 'tile', tileType: 'document', title, description: 'User research evidence',
      icon: null, coverAssetId: null, fields: [], tags: ['research'], link: null, status: null, actions: [],
    }}};
  });
}
export async function provisionDataset(api: APIRequestContext, token: string, id: string, count: number, image: WhiteboardObject) {
  const values = mixedDataset(count, image);
  const existing = values.find(value => value.id === image.id)!;
  await operate(api, token, id, [{type: 'geometry', id: image.id, geometry: existing.geometry}]);
  const pending = values.filter(value => value.id !== image.id).sort((a, b) => Number(a.kind === 'connector') - Number(b.kind === 'connector'));
  // Keep below the API 200-command limit and shared 120 request/minute throttle.
  // Reuse each receipt's authoritative revision instead of issuing an extra head GET.
  let revision = await boardHead(api, token, id);
  const {FULLSTACK_E2E} = await import('./fullstack-smoke-fixture');
  const actor = {kind: 'human', actorId: FULLSTACK_E2E.userId, orgId: FULLSTACK_E2E.orgId, role: 'owner', scopes: ['board:read', 'board:write'], delegatedBy: null};
  const {provenance} = await import('./board-acceptance-support');
  for (let start = 0; start < pending.length; start += 200) {
    const response = await boardApi(api, token, 'POST', `/v1/whiteboards/${id}/operations`, {
      apiVersion: '2026-09-01', requestId: crypto.randomUUID(), boardId: id, expectedRevision: revision,
      actor, commands: createCommands(pending.slice(start, start + 200)), provenance: provenance('human'),
    });
    revision = (await response.json() as {revision: typeof revision}).revision;
  }
  const snapshot = await canonicalSnapshot(api, token, id);
  expect(snapshot.objects).toHaveLength(count);
  expect(new Set(snapshot.objects.map(value => value.id)).size).toBe(count);
  const actual = new Map(snapshot.objects.map(value => [value.id, value]));
  for (const expected of values) expect(actual.get(expected.id)).toMatchObject({kind: expected.kind, text: expected.text, geometry: expected.geometry});
  const kindCounts: Record<string, number> = {};
  for (const value of snapshot.objects) kindCounts[value.kind] = (kindCounts[value.kind] ?? 0) + 1;
  return {snapshot, kindCounts, datasetHash: sha256(JSON.stringify([...snapshot.objects].sort((a, b) => a.id.localeCompare(b.id))))};
}
export type BrowserPerf = {phase: string; frames: Record<string, number[]>; longTasks: Array<{at: number; duration: number}>;
  feedback: Record<string, number[]>; longTaskSupported: boolean};
declare global {interface Window {__boardPerformance: BrowserPerf}}
export async function installBrowserMeasurements(page: Page) {
  await page.addInitScript(() => {
    const result: BrowserPerf = {phase: 'idle', frames: {}, longTasks: [], feedback: {},
      longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask')};
    window.__boardPerformance = result;
    if (result.longTaskSupported) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) result.longTasks.push({at: entry.startTime, duration: entry.duration});
    }).observe({type: 'longtask', buffered: true});
    let previous = performance.now(), previousPhase = 'idle';
    const frame = (now: number) => {
      if (result.phase !== 'idle' && result.phase === previousPhase) (result.frames[result.phase] ??= []).push(now - previous);
      previous = now; previousPhase = result.phase; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
export function observeBoardTransport(page: Page, boardId: string) {
  const pending = new Set<string>();
  const value = {bytesSent: 0, bytesReceived: 0, ackCount: 0, peakPending: 0, pendingAtEnd: 0, errors: [] as string[]};
  page.on('websocket', socket => {
    if (!socket.url().includes(`/whiteboards/${boardId}/sync`)) return;
    socket.on('framesent', frame => {
      value.bytesSent += typeof frame.payload === 'string' ? Buffer.byteLength(frame.payload) : frame.payload.length;
      try { const event = JSON.parse(frame.payload.toString()) as {type?: string; updateId?: string};
        if (event.type === 'update' && event.updateId) pending.add(event.updateId);
        value.peakPending = Math.max(value.peakPending, pending.size); value.pendingAtEnd = pending.size;
      } catch {value.errors.push('UNPARSEABLE_SENT_FRAME');}
    });
    socket.on('framereceived', frame => {
      value.bytesReceived += typeof frame.payload === 'string' ? Buffer.byteLength(frame.payload) : frame.payload.length;
      try { const event = JSON.parse(frame.payload.toString()) as {type?: string; updateId?: string; code?: string};
        if (event.type === 'ack' && event.updateId) {pending.delete(event.updateId); value.ackCount++;}
        if (event.type === 'error') value.errors.push(event.code ?? 'SYNC_ERROR');
        value.pendingAtEnd = pending.size;
      } catch {value.errors.push('UNPARSEABLE_RECEIVED_FRAME');}
    });
  });
  return value;
}
export async function markPhase(page: Page, phase: string) {await page.evaluate(value => {window.__boardPerformance.phase = value;}, phase);}
export async function browserNow(page: Page) {
  return page.evaluate(() => window.performance.now());
}
export async function recordFeedbackSince(page: Page, kind: string, started: number) {
  await page.evaluate(({kind, started}) => {(window.__boardPerformance.feedback[kind] ??= []).push(window.performance.now() - started);}, {kind, started});
}
export const monotonicNow = () => performance.now();
