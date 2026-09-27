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
export type RoomSample = ReturnType<typeof roomClock> & {receiptId: string; state: RoomState; displays: Array<{actorId: string; viewport: Viewport; contentHash: string}>; chainHash: string};
export type RoomEvent = ReturnType<typeof roomClock> & {type: string; before: number; after: number; status?: number; detail: unknown; detailHash: string};
export type RoomLedger = {
  version: 1; sha: string; buildSha: string; boardId: string; roomId: string; presenterId: string; followerIds: string[]; contentHash: string;
  startedAt: string; finishedAt: string; startedMonotonicMs: number; finishedMonotonicMs: number;
  samples: RoomSample[]; events: RoomEvent[]; persistedState: RoomState; finalState: RoomState; signature: string;
};
export const requiredRoomEvents = ['claim', 'follow', 'disconnect', 'reconnect', 'leave-follow', 'refollow', 'cas-conflict', 'handoff', 'manual-pan-leave', 'revoke', 'revoked-read', 'revoked-write', 'release', 'persisted-read', 'reloaded', 'archived'] as const;
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
    let previousViewport = '';
    let previousTime = ledger.startedMonotonicMs, previousRevision = -1, chain = roomHash({sha: ledger.sha, boardId: ledger.boardId, roomId: ledger.roomId, startedAt: ledger.startedAt});
    for (const sample of ledger.samples) {
      const {chainHash, ...body} = sample;
      if (!Number.isFinite(sample.monotonicMs) || sample.monotonicMs < previousTime || sample.monotonicMs - previousTime > ROOM_REQUIREMENTS.maxGapMs || sample.monotonicMs > ledger.finishedMonotonicMs || !Number.isFinite(Date.parse(sample.at)) || Math.abs(Date.parse(sample.at) - start - (sample.monotonicMs - ledger.startedMonotonicMs)) > 2000) failures.push('SAMPLE_TIME');
      if (!Number.isSafeInteger(sample.state.revision) || sample.state.revision <= previousRevision || sample.state.boardId !== ledger.boardId || sample.state.roomId !== ledger.roomId || sample.state.presenterId !== ledger.presenterId) failures.push('REVISION');
      if (sample.displays.length !== 2 || new Set(sample.displays.map(display => display.actorId)).size !== 2 || ledger.followerIds.some(id => !sample.displays.some(display => display.actorId === id) || !sample.state.followers.includes(id))) failures.push('FOLLOWERS');
      for (const display of sample.displays) if (!/^[a-f0-9]{64}$/.test(ledger.contentHash) || display.contentHash !== ledger.contentHash || !['x','y','zoom'].every(axis => Number.isFinite(display.viewport[axis as keyof Viewport]) && Math.abs(display.viewport[axis as keyof Viewport] - sample.state.viewport[axis as keyof Viewport]) < .01)) failures.push('PROJECTION');
      chain = roomHash({previous: chain, sample: body}); if (chain !== chainHash) failures.push('CHAIN');
      const viewportHash = roomHash(sample.state.viewport); if (viewportHash === previousViewport) failures.push('NO_VIEWPORT_CHANGE'); previousViewport = viewportHash;
      previousTime = sample.monotonicMs; previousRevision = sample.state.revision;
    }
    if (ledger.finishedMonotonicMs - previousTime > ROOM_REQUIREMENTS.maxGapMs) failures.push('END_GAP');
    for (const type of requiredRoomEvents) if (ledger.events.filter(event => event.type === type).length !== 1) failures.push(`EVENT_COUNT:${type}`);
    const ordered = requiredRoomEvents.map(type => ledger.events.findIndex(event => event.type === type));
    if (ordered.some((index, position) => position > 0 && index <= ordered[position - 1]!)) failures.push('EVENT_ORDER');
    let eventTime = -Infinity;
    for (const event of ledger.events) {
      if (!Number.isFinite(event.monotonicMs) || event.monotonicMs < eventTime || !Number.isFinite(Date.parse(event.at)) || roomHash(event.detail) !== event.detailHash || !Number.isSafeInteger(event.before) || !Number.isSafeInteger(event.after) || event.after < event.before) failures.push('EVENT');
      if (Math.abs(Date.parse(event.at) - start - (event.monotonicMs - ledger.startedMonotonicMs)) > 2000) failures.push('EVENT_CLOCK');
      eventTime = event.monotonicMs;
      if (event.type === 'cas-conflict' && (event.status !== 409 || event.after !== event.before)) failures.push('CAS');
      if (event.type.startsWith('revoked-') && (event.status !== 403 && event.status !== 404)) failures.push('REVOCATION');
    }
    if ((ledger.events.find(event => event.type === 'disconnect')?.monotonicMs ?? 0) < ledger.startedMonotonicMs || (ledger.events.find(event => event.type === 'reconnect')?.monotonicMs ?? Infinity) > ledger.finishedMonotonicMs) failures.push('RECOVERY_OUTSIDE_SOAK');
    const reconnect = ledger.events.find(event => event.type === 'reconnect')?.detail as {previousTokenHash?: string; nextTokenHash?: string} | undefined;
    if (!reconnect || !/^[a-f0-9]{64}$/.test(reconnect.previousTokenHash ?? '') || !/^[a-f0-9]{64}$/.test(reconnect.nextTokenHash ?? '') || reconnect.previousTokenHash === reconnect.nextTokenHash) failures.push('ROOM_TOKEN_NOT_ROTATED');
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

export type RoomReceipt = ReturnType<typeof roomClock> & {id: string; clientId: string; status: number; method: string; command?: {type: string; actorId: string; expectedRevision: number}; state?: RoomState};
export type RoomRuntime = {sha: string; buildSha: string; dirty: boolean; method: string; deploymentMarker: string; runStartedAt: string; buildCreatedAt: string; buildId: string; chunks: Array<{url: string; sha256: string; localSha256: string}>};
export type RoomArtifact = {version: 1; kind: 'board-meeting-room'; ledger: RoomLedger; runtimeBefore: RoomRuntime; runtimeAfter: RoomRuntime; receipts: RoomReceipt[]; identities: Array<{userId: string; actorId: string}>; observationErrors: string[]};
/** A signed ledger still requires independent raw response/projection/build cross-checks. */
export function validateRoomArtifact(report: RoomArtifact, sha: string, key: string): string[] {
  const failures: string[] = [];
  try {
    if (report.version !== 1 || report.kind !== 'board-meeting-room') failures.push('ARTIFACT_SCHEMA');
    failures.push(...validateRoomLedger(report.ledger, key));
    if (report.ledger.sha !== sha) failures.push('SHA_MISMATCH');
    if (report.observationErrors.length) failures.push('OBSERVER_ERROR');
    for (const identity of [report.runtimeBefore, report.runtimeAfter]) {
      if (identity.sha !== sha || identity.buildSha !== sha || identity.dirty !== false || identity.method !== 'fresh-server-marker-and-built-chunk-hashes' || !/^[a-f0-9-]{36}$/.test(identity.deploymentMarker) || !identity.buildId
        || !Number.isFinite(Date.parse(identity.runStartedAt)) || !Number.isFinite(Date.parse(identity.buildCreatedAt)) || Date.parse(identity.buildCreatedAt) < Date.parse(identity.runStartedAt) || Date.parse(identity.buildCreatedAt) > Date.parse(report.ledger.startedAt)
        || !identity.chunks.length || identity.chunks.some(chunk => !chunk.url.startsWith('/_next/static/') || !/^[a-f0-9]{64}$/.test(chunk.sha256) || chunk.sha256 !== chunk.localSha256)) failures.push('RUNTIME_IDENTITY');
    }
    if (report.runtimeBefore.deploymentMarker !== report.runtimeAfter.deploymentMarker || report.runtimeBefore.buildId !== report.runtimeAfter.buildId) failures.push('RUNTIME_CHANGED');
    const identities = report.identities;
    if (identities.length !== 3 || new Set(identities.map(value => value.userId)).size !== 3 || new Set(identities.map(value => value.actorId)).size !== 3
      || [report.ledger.presenterId, ...report.ledger.followerIds].some(id => !identities.some(identity => identity.actorId === id))) failures.push('REAL_IDENTITIES');
    const receipts = new Map(report.receipts.map(receipt => [receipt.id, receipt]));
    if (receipts.size !== report.receipts.length) failures.push('DUPLICATE_RECEIPT');
    for (const receipt of report.receipts) {
      if (!Number.isFinite(receipt.monotonicMs) || !Number.isFinite(Date.parse(receipt.at)) || !identities.some(identity => identity.userId === receipt.clientId)) failures.push('RECEIPT_CONTEXT');
      if (receipt.method === 'POST' && receipt.status >= 200 && receipt.status < 300 && receipt.command && (!receipt.state || receipt.state.revision !== receipt.command.expectedRevision + 1)) failures.push('RECEIPT_REVISION');
    }
    const consumed = new Set<string>();
    for (const sample of report.ledger.samples) {
      const receipt = receipts.get(sample.receiptId);
      if (!receipt || consumed.has(sample.receiptId) || receipt.method !== 'GET' || receipt.status !== 200 || roomCanonical(receipt.state) !== roomCanonical(sample.state)
        || receipt.monotonicMs > sample.monotonicMs || sample.monotonicMs - receipt.monotonicMs > ROOM_REQUIREMENTS.maxGapMs) failures.push('SAMPLE_RECEIPT');
      consumed.add(sample.receiptId);
      if (!report.receipts.some(raw => raw.method === 'POST' && raw.status >= 200 && raw.status < 300 && raw.command?.type === 'viewport' && raw.command.actorId === report.ledger.presenterId && raw.state?.revision === sample.state.revision && roomCanonical(raw.state.viewport) === roomCanonical(sample.state.viewport))) failures.push('MISSING_BROWSER_VIEWPORT_WRITE');
    }
    if (!report.receipts.some(receipt => receipt.status === 409 && receipt.command?.type === 'handoff')) failures.push('MISSING_CAS_RESPONSE');
    for (const method of ['GET','POST']) if (!report.receipts.some(receipt => receipt.method === method && [403,404].includes(receipt.status))) failures.push('MISSING_REVOKED_RESPONSE');
  } catch {failures.push('ARTIFACT_MALFORMED');}
  return [...new Set(failures)];
}
