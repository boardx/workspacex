import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardServerMessage, type WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';
import { apiWebSocketUrl, getStoredSessionToken } from './api-client';
import { fingerprintWhiteboardSession, IndexedDbWhiteboardOutbox, WhiteboardOutboxLimitError, type PendingWhiteboardUpdate, type WhiteboardOutboxContext, type WhiteboardOutboxPort, type WhiteboardOutboxScope } from './whiteboard-outbox';
export type WhiteboardConnectionState = {
  phase: 'connecting' | 'online' | 'offline' | 'blocked'; pending: number;
  quarantined: number;
  role: 'owner' | 'editor' | 'viewer'; archived: boolean;
  peers: Extract<WhiteboardServerMessage, { type: 'presence' }>['peers']; reason: string | null;
};
const REMOTE = Symbol('whiteboard-server');
export function bytesToBase64(bytes: Uint8Array): string { let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); }
export function base64ToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export type WhiteboardProviderOptions = { principalId: string; sessionId?: string; outbox?: WhiteboardOutboxPort };

/** Durable, encrypted local outbox. A server ACK is the only normal deletion path. */
export class WhiteboardProvider {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private sessionTimer: ReturnType<typeof setInterval>;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private latestPresence: Extract<WhiteboardClientMessage, { type: 'awareness' }> | null = null;
  private stopped = false;
  private ready = false;
  private retry = 0;
  private epoch: number | null = null;
  private pending: PendingWhiteboardUpdate[] = [];
  private state: WhiteboardConnectionState = { phase: 'connecting', pending: 0, quarantined: 0, role: 'viewer', archived: false, peers: [], reason: null };
  private readonly token = getStoredSessionToken();
  private context: WhiteboardOutboxContext | null = null;
  private readonly outbox: WhiteboardOutboxPort;
  private operation = Promise.resolve();
  constructor(private doc: Y.Doc, private boardId: string, private onState: (state: WhiteboardConnectionState) => void, private options: WhiteboardProviderOptions) {
    this.outbox = options.outbox ?? new IndexedDbWhiteboardOutbox();
    doc.on('update', this.onUpdate);
    this.sessionTimer = setInterval(() => { if (getStoredSessionToken() !== this.token) this.block('SESSION_CHANGED'); }, 1000);
    void this.start();
  }
  private async start() {
    if (!this.token) { this.block('SESSION_CHANGED'); return; }
    const sessionId = this.options.sessionId ?? await fingerprintWhiteboardSession(this.token);
    if (this.stopped) return;
    this.context = { boardId: this.boardId, principalId: this.options.principalId, sessionId };
    this.connect();
  }
  private publish(patch: Partial<WhiteboardConnectionState>) { this.state = { ...this.state, ...patch, pending: this.pending.length }; this.onState(this.state); }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.stopped) return;
    if (!this.epoch || this.state.role === 'viewer' || this.state.archived) { this.block('WRITE_DENIED'); return; }
    const message: PendingWhiteboardUpdate = { type: 'update', epoch: this.epoch, updateId: crypto.randomUUID(), update: bytesToBase64(update) };
    const scope = this.scope();
    if (!scope) { this.block('PROTOCOL_ERROR'); return; }
    this.operation = this.operation.then(async () => {
      await this.outbox.put(scope, message);
      if (this.stopped) return;
      this.pending.push(message); this.publish({}); if (this.ready) this.send(message);
    }).catch(error => this.block(error instanceof WhiteboardOutboxLimitError ? 'PENDING_LIMIT' : 'OUTBOX_ERROR'));
  };
  private send(message: WhiteboardClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private connect() {
    if (this.stopped || !this.context) return;
    if (!this.token || getStoredSessionToken() !== this.token) { this.block('SESSION_CHANGED'); return; }
    this.ready = false; this.publish({ phase: this.epoch ? 'offline' : 'connecting' });
    const socket = new WebSocket(apiWebSocketUrl(WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(this.boardId))), [WHITEBOARD_SYNC.protocol, WHITEBOARD_SYNC.bearerSubprotocolPrefix + this.token]);
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(), 10000);
    socket.onopen = () => this.send({ type: 'hello', stateVector: bytesToBase64(Y.encodeStateVector(this.doc)) });
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const message = WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (message.type === 'error') { this.block(message.code); return; }
        if (message.type === 'sync') {
          if (this.epoch !== null && this.epoch !== message.epoch) { this.block('STALE_EPOCH'); return; }
          if ((message.role === 'viewer' || message.archived) && this.pending.length) { this.block('WRITE_DENIED'); return; }
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE); this.epoch = message.epoch;
          const scope = this.scope();
          if (!scope || !this.context) { this.block('PROTOCOL_ERROR'); return; }
          this.operation = this.operation.then(async () => {
            await this.outbox.quarantineExcept(this.context!, message.epoch, 'STALE_EPOCH');
            this.pending = await this.outbox.load(scope);
            if ((message.role === 'viewer' || message.archived) && this.pending.length) { this.block('WRITE_DENIED'); return; }
            for (const item of this.pending) Y.applyUpdate(this.doc, base64ToBytes(item.update), REMOTE);
            if (this.stopped || this.socket !== socket) return;
            this.ready = true; this.retry = 0;
            if (this.handshake) clearTimeout(this.handshake);
            this.publish({ phase: 'online', role: message.role, archived: message.archived, reason: null });
            for (const item of this.pending) this.send(item);
          }).catch(() => this.block('OUTBOX_ERROR'));
        } else if (message.type === 'update') {
          if (!this.ready || message.epoch !== this.epoch) { this.block('STALE_EPOCH'); return; }
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
        } else if (message.type === 'ack') {
          if (!this.ready) { this.block('PROTOCOL_ERROR'); return; }
          const scope = this.scope();
          if (!scope) { this.block('PROTOCOL_ERROR'); return; }
          this.operation = this.operation.then(async () => {
            await this.outbox.ack(scope, message.updateId);
            this.pending = this.pending.filter(item => item.updateId !== message.updateId); this.publish({});
          }).catch(() => this.block('OUTBOX_ERROR'));
        } else if (message.type === 'presence') this.publish({ peers: message.peers });
      } catch { this.block('PROTOCOL_ERROR'); }
    };
    socket.onclose = event => {
      if (this.handshake) clearTimeout(this.handshake);
      if (this.stopped || this.socket !== socket) return;
      this.ready = false;
      if ([1008, 4001, 4003, 4401, 4403].includes(event.code)) { this.block('ACCESS_DENIED'); return; }
      this.publish({ phase: 'offline', peers: [] });
      this.timer = setTimeout(() => this.connect(), Math.min(15000, 500 * 2 ** Math.min(this.retry++, 5)));
    };
    socket.onerror = () => socket.close();
  }
  private scope(): WhiteboardOutboxScope | null { return this.context && this.epoch ? { ...this.context, epoch: this.epoch } : null; }
  awareness(cursor: { x: number; y: number } | null, selected: string[]) {
    if (!this.ready || this.stopped || (cursor && (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)))) return;
    this.latestPresence = { type: 'awareness', cursor, selected: selected.slice(0,200) };
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; if (this.ready && !this.stopped && this.latestPresence) this.send(this.latestPresence); }, 50);
  }
  private block(reason: string) {
    if (this.stopped) return;
    const context = this.context;
    this.close();
    // Hide and remove locally visible content after access loss; no clear update is sent.
    this.doc.transact(() => { this.doc.getMap('objects').clear(); this.doc.getMap('deletedObjects').clear(); }, REMOTE);
    this.publish({ phase: 'blocked', role: 'viewer', peers: [], reason });
    if (context) this.operation = this.operation.catch(() => undefined).then(() => this.outbox.quarantineExcept(context, null, reason)).then(receipts => {
      this.pending = [];
      this.publish({ quarantined: receipts.reduce((sum, receipt) => sum + receipt.pendingCount, 0) });
    }).catch(() => { this.pending = []; this.publish({ quarantined: 0 }); });
  }
  close() { if (this.presenceTimer) clearTimeout(this.presenceTimer); this.stopped = true; this.ready = false; if (this.timer) clearTimeout(this.timer); if (this.handshake) clearTimeout(this.handshake); clearInterval(this.sessionTimer); this.doc.off('update', this.onUpdate); this.socket?.close(); }
}
