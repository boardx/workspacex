import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardServerMessage, type WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';
import { apiWebSocketUrl, getStoredSessionToken } from './api-client';
export type WhiteboardConnectionState = {
  phase: 'connecting' | 'online' | 'offline' | 'blocked'; pending: number;
  role: 'owner' | 'editor' | 'viewer'; archived: boolean;
  peers: Extract<WhiteboardServerMessage, { type: 'presence' }>['peers']; reason: string | null;
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
  private pending: Extract<WhiteboardClientMessage, { type: 'update' }>[] = [];
  private state: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null };
  private readonly token = getStoredSessionToken();
  constructor(private doc: Y.Doc, private boardId: string, private onState: (state: WhiteboardConnectionState) => void) {
    doc.on('update', this.onUpdate);
    this.sessionTimer = setInterval(() => { if (getStoredSessionToken() !== this.token) this.block('SESSION_CHANGED'); }, 1000);
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
  private connect() {
    if (this.stopped) return;
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
          if (this.seq !== null && message.seq < this.seq) { this.block('STALE_SEQUENCE'); return; }
          if ((message.role === 'viewer' || message.archived) && this.pending.length) { this.block('WRITE_DENIED'); return; }
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE); this.epoch = message.epoch; this.seq = message.seq; this.ready = true; this.retry = 0;
          if (this.handshake) clearTimeout(this.handshake);
          this.publish({ phase: 'online', role: message.role, archived: message.archived, reason: null });
          for (const item of this.pending) this.send(item);
        } else if (message.type === 'update') {
          if (!this.ready || message.epoch !== this.epoch) { this.block('STALE_EPOCH'); return; }
          if (this.seq !== null && message.seq <= this.seq) return;
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
          this.seq = message.seq;
        } else if (message.type === 'ack') {
          if (!this.ready) { this.block('PROTOCOL_ERROR'); return; }
          this.pending = this.pending.filter(item => item.updateId !== message.updateId); this.publish({});
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
  awareness(cursor: { x: number; y: number } | null, selected: string[]) {
    if (!this.ready || this.stopped || (cursor && (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)))) return;
    this.latestPresence = { type: 'awareness', cursor, selected: selected.slice(0,200) };
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => { this.presenceTimer = null; if (this.ready && !this.stopped && this.latestPresence) this.send(this.latestPresence); }, 50);
  }
  private block(reason: string) {
    if (this.stopped) return;
    this.close(); this.pending = [];
    // Hide and remove locally visible content after access loss; no clear update is sent.
    this.doc.transact(() => { this.doc.getMap('objects').clear(); this.doc.getMap('deletedObjects').clear(); }, REMOTE);
    this.publish({ phase: 'blocked', role: 'viewer', peers: [], reason });
  }
  close() { if (this.presenceTimer) clearTimeout(this.presenceTimer); this.stopped = true; this.ready = false; if (this.timer) clearTimeout(this.timer); if (this.handshake) clearTimeout(this.handshake); clearInterval(this.sessionTimer); this.doc.off('update', this.onUpdate); this.socket?.close(); }
}
