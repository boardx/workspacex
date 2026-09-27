import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Page} from '@playwright/test';
import * as Y from 'yjs';
import {createWhiteboardDocument, readObjects, type WhiteboardObject} from '@repo/whiteboard-core';
import type {SoakIdentity} from './board-soak-identities';

export const soakHash = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}` : JSON.stringify(value);
export const canonicalHash = (doc: Y.Doc) => soakHash(readObjects(doc).sort((a, b) => a.id.localeCompare(b.id)));
export type RawAck = {operationId: string; actorId: string; revision: number; sentAt: string; acknowledgedAt: string; sentMonotonicMs: number; acknowledgedMonotonicMs: number};
export type TransportEvent = {at: string; clientId: string; type: 'sync' | 'disconnect' | 'error'; revision: number; code?: string};
export type Projection = {id: string; kind: string; text: string; geometry: WhiteboardObject['geometry']; parentId: string};
export const projectedRows = (doc: Y.Doc): Projection[] => readObjects(doc).map(object => ({id: object.id, kind: object.kind, text: object.text, geometry: object.geometry, parentId: object.parentId ?? ''})).sort((a, b) => a.id.localeCompare(b.id));

/** Read-only wire tap: uses actual browser WebSocket frames, never creates or replaces a socket. */
export class BoardSoakClient {
  readonly doc = createWhiteboardDocument();
  readonly acknowledgements: RawAck[] = [];
  readonly events: TransportEvent[] = [];
  readonly serverHashes = new Map<number, string>();
  readonly failures: string[] = [];
  readonly sent = new Map<string, {at: string; monotonic: number}>();
  connected = false;
  revision = 0;
  role: string | null = null;
  epoch: number | null = null;
  constructor(readonly page: Page, readonly actor: SoakIdentity, readonly boardId: string) {
    page.on('websocket', socket => {
      if (new URL(socket.url()).pathname !== `/whiteboards/${boardId}/sync`) return;
      socket.on('framesent', event => this.frame(event.payload, true));
      socket.on('framereceived', event => this.frame(event.payload, false));
      socket.on('close', () => {this.connected = false; this.events.push({at: new Date().toISOString(), clientId: actor.userId, type: 'disconnect', revision: this.revision});});
      socket.on('socketerror', () => this.fail('WEBSOCKET_ERROR'));
    });
  }
  private fail(code: string) { this.failures.push(code); this.events.push({at: new Date().toISOString(), clientId: this.actor.userId, type: 'error', revision: this.revision, code}); }
  private frame(payload: string | Buffer, outgoing: boolean) {
    try {
      const message = JSON.parse(payload.toString()) as {type: string; update?: string; updateId?: string; seq?: number; epoch?: number; role?: string; code?: string};
      if (outgoing) {
        if (message.type !== 'update') return;
        if (!message.update || !message.updateId) throw new Error('INVALID_UPDATE');
        if (!this.sent.has(message.updateId)) this.sent.set(message.updateId, {at: new Date().toISOString(), monotonic: performance.now()});
        Y.applyUpdate(this.doc, Buffer.from(message.update, 'base64'));
        return;
      }
      if (message.type === 'error') {this.fail('SERVER_REJECTED_UPDATE'); return;}
      if (message.type === 'presence') return;
      if (!Number.isSafeInteger(message.seq) || message.seq! < 0) throw new Error('INVALID_SEQUENCE');
      if (message.type === 'sync' || message.type === 'update') {
        if (!message.update || !Number.isSafeInteger(message.epoch)) throw new Error('INVALID_SERVER_UPDATE');
        if (this.epoch !== null && message.epoch !== this.epoch) throw new Error('UNEXPECTED_EPOCH_CHANGE');
        this.epoch = message.epoch!;
        Y.applyUpdate(this.doc, Buffer.from(message.update, 'base64'));
        this.revision = Math.max(this.revision, message.seq!);
        // A viewer has no speculative local edits: its wire snapshot is the committed state per revision.
        if (this.actor.role === 'viewer') this.serverHashes.set(message.seq!, canonicalHash(this.doc));
        if (message.type === 'sync') {
          this.connected = true; this.role = message.role ?? null;
          this.events.push({at: new Date().toISOString(), clientId: this.actor.userId, type: 'sync', revision: this.revision});
        }
      } else if (message.type === 'ack') {
        const sent = this.sent.get(message.updateId ?? '');
        if (!sent) throw new Error('ACK_WITHOUT_REAL_SEND');
        this.revision = Math.max(this.revision, message.seq!);
        const existing = this.acknowledgements.find(ack => ack.operationId === message.updateId);
        if (existing && existing.revision !== message.seq) throw new Error('ACK_REVISION_CONTRADICTION');
        if (!existing) this.acknowledgements.push({operationId: message.updateId!, actorId: this.actor.userId, revision: message.seq!, sentAt: sent.at, acknowledgedAt: new Date().toISOString(), sentMonotonicMs: sent.monotonic, acknowledgedMonotonicMs: performance.now()});
      }
    } catch {this.fail('INVALID_TRANSPORT_FRAME');}
  }
  assertHealthy() { if (this.failures.length) throw new Error(`SOAK_TRANSPORT_FAILURE:${this.actor.userId}:${this.failures.join(',')}`); }
  destroy() {this.doc.destroy();}
}

/** DOM observation timestamps are generated when the actual product mirror changes. */
export async function installSoakProjectionObserver(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="board-a11y-mirror"]');
    if (!root) throw new Error('SOAK_CANONICAL_MIRROR_MISSING');
    const target = window as unknown as {__boardSoakProjection?: {serialized: string; observedAt: number}};
    const observe = () => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('li[data-object-id]')).map(row => {
        if (!row.dataset.geometry || !row.dataset.objectKind) throw new Error('SOAK_CANONICAL_ATTRIBUTES_MISSING');
        return {id: row.dataset.objectId!, kind: row.dataset.objectKind, text: row.querySelector('button')?.textContent ?? '', geometry: JSON.parse(row.dataset.geometry), parentId: row.dataset.parentId ?? ''};
      }).sort((a, b) => a.id.localeCompare(b.id));
      const serialized = JSON.stringify(rows);
      if (serialized !== target.__boardSoakProjection?.serialized) target.__boardSoakProjection = {serialized, observedAt: performance.timeOrigin + performance.now()};
    };
    observe();
    new MutationObserver(observe).observe(root, {subtree: true, childList: true, characterData: true, attributes: true});
  });
}
export async function projectionSnapshot(page: Page) {
  return page.evaluate(() => {
    const value = (window as unknown as {__boardSoakProjection?: {serialized: string; observedAt: number}}).__boardSoakProjection;
    if (!value) throw new Error('SOAK_OBSERVER_NOT_INSTALLED');
    return value;
  });
}
