import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardServerMessage, type WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';
import { apiWebSocketUrl, getStoredSessionToken } from './api-client';
export type WhiteboardConnectionState = {
  phase: 'connecting' | 'online' | 'offline' | 'blocked'; pending: number;
  role: 'owner' | 'editor' | 'viewer'; archived: boolean;
  peers: Extract<WhiteboardServerMessage, { type: 'presence' }>['peers']; reason: string | null;
  retryAttempt: number; duplicateAcks: number; lastAckSequence: number | null;
};
const REMOTE = Symbol('whiteboard-server');
export function bytesToBase64(bytes: Uint8Array): string { let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); }
export function base64ToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
/** In-memory pending writes only. Host must warn on page exit; no offline durability claim. */
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
  private seq: number | null = null;
  private token = getStoredSessionToken();
  private readonly acked = new Set<string>();
  private readonly retryableClose = new WeakSet<WebSocket>();
  private pending: Extract<WhiteboardClientMessage, { type: 'update' }>[] = [];
  private state: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null, retryAttempt: 0, duplicateAcks: 0, lastAckSequence: null };
  constructor(private doc: Y.Doc, private boardId: string, private onState: (state: WhiteboardConnectionState) => void) {
    doc.on('update', this.onUpdate);
    this.sessionTimer = setInterval(() => {
      const next = getStoredSessionToken();
      if (next === this.token) return;
      if (!next) { this.block('SESSION_REVOKED'); return; }
      this.token = next; this.ready = false; this.socket?.close(); this.connect('AUTH_REFRESH');
    }, 1000);
    this.connect();
  }
  private publish(patch: Partial<WhiteboardConnectionState>) { this.state = { ...this.state, ...patch, pending: this.pending.length }; this.onState(this.state); }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.stopped) return;
    if (!this.epoch || this.state.role === 'viewer' || this.state.archived) { this.block('WRITE_DENIED'); return; }
    const message: Extract<WhiteboardClientMessage, { type: 'update' }> = { type: 'update', epoch: this.epoch, updateId: crypto.randomUUID(), update: bytesToBase64(update) };
    const bytes = this.pending.reduce((sum, item) => sum + item.update.length, 0) + message.update.length;
    if (this.pending.length >= WHITEBOARD_SYNC.pendingUpdates || bytes > WHITEBOARD_SYNC.pendingBytes) { this.block('PENDING_LIMIT'); return; }
    this.pending.push(message); this.publish({}); if (this.ready) this.send(message);
  };
  private send(message: WhiteboardClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private connect(reason: string | null = null) {
    if (this.stopped) return;
    if (!this.token || getStoredSessionToken() !== this.token) { this.block('SESSION_CHANGED'); return; }
    this.ready = false; this.publish({ phase: this.epoch ? 'offline' : 'connecting', reason, retryAttempt: this.retry });
    const socket = new WebSocket(apiWebSocketUrl(WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(this.boardId))), [WHITEBOARD_SYNC.protocol, WHITEBOARD_SYNC.bearerSubprotocolPrefix + this.token]);
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(), 10000);
    socket.onopen = () => this.send({ type: 'hello', stateVector: bytesToBase64(Y.encodeStateVector(this.doc)), ...(this.epoch && this.seq !== null ? { resume: { epoch: this.epoch, seq: this.seq } } : {}) });
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const message = WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (message.type === 'error') {
          if (message.recoverable) { this.retryableClose.add(socket); this.publish({ phase: 'offline', reason: message.code }); socket.close(); return; }
          this.block(message.code); return;
        }
        if (message.type === 'sync') {
          if (this.epoch !== null && this.epoch !== message.epoch) { this.block('STALE_EPOCH'); return; }
          if (this.seq !== null && message.seq < this.seq) { this.block('STALE_SEQUENCE'); return; }
          if ((message.role === 'viewer' || message.archived) && this.pending.length) { this.block('WRITE_DENIED'); return; }
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE); this.epoch = message.epoch; this.seq = message.seq; this.ready = true; this.retry = 0;
          if (this.handshake) clearTimeout(this.handshake);
          this.publish({ phase: 'online', role: message.role, archived: message.archived, reason: null, retryAttempt: 0 });
          for (const item of this.pending) this.send(item);
        } else if (message.type === 'update') {
          if (!this.ready || message.epoch !== this.epoch) { this.block('STALE_EPOCH'); return; }
          if (this.seq !== null && message.seq <= this.seq) return;
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
          this.seq = message.seq;
        } else if (message.type === 'ack') {
          if (!this.ready) { this.block('PROTOCOL_ERROR'); return; }
          const index = this.pending.findIndex(item => item.updateId === message.updateId);
          if (index < 0) {
            if (this.acked.has(message.updateId)) { this.publish({ duplicateAcks: this.state.duplicateAcks + 1, lastAckSequence: message.seq }); return; }
            this.block('ACK_CONFLICT'); return;
          }
          this.pending.splice(index, 1); this.acked.add(message.updateId);
          while (this.acked.size > WHITEBOARD_SYNC.pendingUpdates) this.acked.delete(this.acked.values().next().value!);
          this.publish({ lastAckSequence: message.seq });
        } else if (message.type === 'recovery') {
          if (message.disposition === 'access-revoked') { this.block('ACCESS_REVOKED'); return; }
          if (message.disposition === 'board-archived') { this.block('BOARD_ARCHIVED'); return; }
          if (message.disposition === 'reload-required') { this.block(message.code); return; }
          if (message.disposition === 'retry-later') { this.retryableClose.add(socket); socket.close(); this.publish({ phase: 'offline', reason: message.code }); return; }
          this.publish({ reason: null });
        } else if (message.type === 'presence') this.publish({ peers: message.peers });
      } catch { this.block('PROTOCOL_ERROR'); }
    };
    socket.onclose = event => {
      if (this.handshake) clearTimeout(this.handshake);
      if (this.stopped || this.socket !== socket) return;
      this.ready = false;
      if ([1008, 4001, 4003, 4401, 4403].includes(event.code) && !this.retryableClose.has(socket)) { this.block('ACCESS_DENIED'); return; }
      const delay = Math.min(15000, 500 * 2 ** Math.min(this.retry++, 5));
      this.publish({ phase: 'offline', peers: [], reason: this.state.reason ?? 'CONNECTION_LOST', retryAttempt: this.retry });
      this.timer = setTimeout(() => this.connect('RETRYING'), delay);
    };
    socket.onerror = () => socket.close();
  }
  awareness(cursor: { x: number; y: number } | null, selected: string[], editingObjectId: string | null = null) {
    if (!this.ready || this.stopped || (cursor && (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)))) return;
    this.latestPresence = { type: 'awareness', cursor, selected: selected.slice(0,200), editingObjectId };
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; if (this.ready && !this.stopped && this.latestPresence) this.send(this.latestPresence); }, 50);
  }
  retryNow() { if (this.stopped || this.state.phase === 'blocked') return; if (this.timer) clearTimeout(this.timer); this.retry = 0; this.socket?.close(); this.connect('MANUAL_RETRY'); }
  private block(reason: string) {
    if (this.stopped) return;
    this.close(); this.pending = [];
    // Hide and remove locally visible content after access loss; no clear update is sent.
    this.doc.transact(() => { this.doc.getMap('objects').clear(); this.doc.getMap('deletedObjects').clear(); this.doc.getMap('commentThreads').clear(); }, REMOTE);
    this.publish({ phase: 'blocked', role: 'viewer', peers: [], reason });
  }
  close() { if (this.presenceTimer) clearTimeout(this.presenceTimer); this.stopped = true; this.ready = false; if (this.timer) clearTimeout(this.timer); if (this.handshake) clearTimeout(this.handshake); clearInterval(this.sessionTimer); this.doc.off('update', this.onUpdate); this.socket?.close(); }
}
