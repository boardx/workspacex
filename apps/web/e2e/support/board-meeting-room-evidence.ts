import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Page} from '@playwright/test';

// Separate lifecycle ledger: the 50-client load ledger cannot prove a meeting took place.
export const ROOM_REQUIREMENTS = {durationMs: 30 * 60_000, minSamples: 360, maxGapMs: 30_000} as const;
export type Viewport = {x: number; y: number; zoom: number};
export type RoomState = {boardId: string; roomId: string; revision: number; presenterId: string | null; viewport: Viewport; followers: string[]; updatedAt: string};
export const roomCanonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(roomCanonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${roomCanonical(item)}`).join(',')}}` : JSON.stringify(value);
export const roomHash = (value: unknown) => createHash('sha256').update(roomCanonical(value)).digest('hex');
export const roomClock = () => ({at: new Date().toISOString(), monotonicMs: performance.now()});
export type RoomSample = ReturnType<typeof roomClock> & {state: RoomState; displays: Array<{actorId: string; viewport: Viewport}>; chainHash: string};
export type RoomEvent = ReturnType<typeof roomClock> & {type: string; before: number; after: number; status?: number; detailHash: string};
export type RoomLedger = {
  version: 1; sha: string; buildSha: string; boardId: string; roomId: string; presenterId: string; followerIds: string[];
  startedAt: string; finishedAt: string; startedMonotonicMs: number; finishedMonotonicMs: number;
  samples: RoomSample[]; events: RoomEvent[]; persistedState: RoomState; finalState: RoomState; signature: string;
};
export const requiredRoomEvents = ['claim', 'follow', 'disconnect', 'reconnect', 'leave-follow', 'refollow', 'handoff', 'manual-pan-leave', 'cas-conflict', 'revoke', 'revoked-read', 'revoked-write', 'release', 'persisted-read', 'reloaded', 'archived'] as const;
export function signRoomLedger(body: Omit<RoomLedger, 'signature'>, key: string): RoomLedger {
  if (key.length < 32) throw new Error('ROOM_SIGNING_KEY_TOO_SHORT');
  return {...body, signature: createHmac('sha256', key).update(roomCanonical(body)).digest('hex')};
}
export function validateRoomLedger(ledger: RoomLedger, key: string): string[] {
  const failures: string[] = [];
  try {
    const expected = createHmac('sha256', key).update(roomCanonical(ledger)).digest(), actual = Buffer.from(ledger.signature, 'hex');
    if (key.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) failures.push('SIGNATURE');
    if (ledger.version !== 1 || !/^[a-f0-9]{40}$/.test(ledger.sha) || ledger.buildSha !== ledger.sha) failures.push('BUILD_IDENTITY');
    const start = Date.parse(ledger.startedAt), finish = Date.parse(ledger.finishedAt), elapsed = ledger.finishedMonotonicMs - ledger.startedMonotonicMs;
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish - start < ROOM_REQUIREMENTS.durationMs || !Number.isFinite(elapsed) || elapsed < ROOM_REQUIREMENTS.durationMs || Math.abs(finish - start - elapsed) > 2000) failures.push('DURATION');
    if (ledger.samples.length < ROOM_REQUIREMENTS.minSamples || new Set(ledger.followerIds).size !== 2 || ledger.followerIds.includes(ledger.presenterId)) failures.push('COVERAGE');
    let previousTime = ledger.startedMonotonicMs, previousRevision = -1, chain = roomHash({sha: ledger.sha, boardId: ledger.boardId, roomId: ledger.roomId, startedAt: ledger.startedAt});
    for (const sample of ledger.samples) {
      const {chainHash, ...body} = sample;
      if (!Number.isFinite(sample.monotonicMs) || sample.monotonicMs < previousTime || sample.monotonicMs - previousTime > ROOM_REQUIREMENTS.maxGapMs || sample.monotonicMs > ledger.finishedMonotonicMs || !Number.isFinite(Date.parse(sample.at)) || Math.abs(Date.parse(sample.at) - start - (sample.monotonicMs - ledger.startedMonotonicMs)) > 2000) failures.push('SAMPLE_TIME');
      if (!Number.isSafeInteger(sample.state.revision) || sample.state.revision <= previousRevision || sample.state.boardId !== ledger.boardId || sample.state.roomId !== ledger.roomId || sample.state.presenterId !== ledger.presenterId) failures.push('REVISION');
      if (sample.displays.length !== 2 || new Set(sample.displays.map(display => display.actorId)).size !== 2 || ledger.followerIds.some(id => !sample.displays.some(display => display.actorId === id) || !sample.state.followers.includes(id))) failures.push('FOLLOWERS');
      for (const display of sample.displays) if (!['x','y','zoom'].every(axis => Number.isFinite(display.viewport[axis as keyof Viewport]) && Math.abs(display.viewport[axis as keyof Viewport] - sample.state.viewport[axis as keyof Viewport]) < .01)) failures.push('PROJECTION');
      chain = roomHash({previous: chain, sample: body}); if (chain !== chainHash) failures.push('CHAIN');
      previousTime = sample.monotonicMs; previousRevision = sample.state.revision;
    }
    if (ledger.finishedMonotonicMs - previousTime > ROOM_REQUIREMENTS.maxGapMs) failures.push('END_GAP');
    for (const type of requiredRoomEvents) if (!ledger.events.some(event => event.type === type)) failures.push(`MISSING:${type}`);
    let eventTime = -Infinity;
    for (const event of ledger.events) {
      if (!Number.isFinite(event.monotonicMs) || event.monotonicMs < eventTime || !Number.isFinite(Date.parse(event.at)) || !/^[a-f0-9]{64}$/.test(event.detailHash) || !Number.isSafeInteger(event.before) || !Number.isSafeInteger(event.after) || event.after < event.before) failures.push('EVENT');
      eventTime = event.monotonicMs;
      if (event.type === 'cas-conflict' && (event.status !== 409 || event.after !== event.before)) failures.push('CAS');
      if (event.type.startsWith('revoked-') && (event.status !== 403 && event.status !== 404)) failures.push('REVOCATION');
    }
    if (roomCanonical(ledger.finalState) !== roomCanonical(ledger.persistedState) || ledger.finalState.boardId !== ledger.boardId || ledger.finalState.roomId !== ledger.roomId || ledger.finalState.presenterId !== null || ledger.finalState.followers.length || ledger.finalState.revision < previousRevision) failures.push('PERSISTENCE');
  } catch {failures.push('MALFORMED');}
  return [...new Set(failures)];
}
/** Observe the production Fabric projection, without setting app state or synthesizing input. */
export async function readRoomViewport(page: Page): Promise<Viewport> {
  const surface = page.getByTestId('board-fabric-surface');
  const values = await Promise.all(['data-viewport-pan-x', 'data-viewport-pan-y', 'data-viewport-zoom'].map(attribute => surface.getAttribute(attribute)));
  if (values.some(value => value === null || !Number.isFinite(Number(value)))) throw new Error('ROOM_VIEWPORT_PROJECTION_UNAVAILABLE');
  return {x: Number(values[0]), y: Number(values[1]), zoom: Number(values[2])};
}
