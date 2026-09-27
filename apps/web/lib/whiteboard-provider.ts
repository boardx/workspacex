import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardServerMessage, type WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';
import { apiWebSocketUrl, getStoredSessionToken } from './api-client';
import { createWhiteboardOutbox, type WhiteboardDurableOutbox } from './whiteboard-outbox';
export type WhiteboardConnectionState = {
  phase: 'connecting' | 'online' | 'offline' | 'blocked'; pending: number;
  role: 'owner' | 'editor' | 'commenter' | 'viewer'; archived: boolean;
  peers: Extract<WhiteboardServerMessage, { type: 'presence' }>['peers']; reason: string | null;
  retryAttempt: number; duplicateAcks: number; lastAckSequence: number | null; lastAckReceipt: {updateId:string;gestureId:string;seq:number}|null;
};
const REMOTE = Symbol('whiteboard-server');
// The gateway accepts at most 32 queued frames per socket. Keep a large reserve
// for the handshake, presence and network scheduling while durable updates await ACK.
const OUTBOUND_UPDATE_WINDOW = 8;
export function bytesToBase64(bytes: Uint8Array): string { let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); }
export function base64ToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
/** Authenticated realtime transport with an encrypted, bounded IndexedDB outbox when available. */
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
  private refreshingToken: string | null = null;
  private persistenceTail: Promise<void> = Promise.resolve();
  private readonly outbox: WhiteboardDurableOutbox | null;
  private readonly acked = new Set<string>();
  private readonly retryableClose = new WeakSet<WebSocket>();
  private inFlight = new Set<string>();
  private persisted = new Set<string>();
  private pending: Extract<WhiteboardClientMessage, { type: 'update' }>[] = [];
  private state: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null, retryAttempt: 0, duplicateAcks: 0, lastAckSequence: null, lastAckReceipt:null };
  constructor(private doc: Y.Doc, private boardId: string, private onState: (state: WhiteboardConnectionState) => void, outbox?: WhiteboardDurableOutbox | null) {
    this.outbox = outbox === undefined ? createWhiteboardOutbox(boardId) : outbox;
    doc.on('update', this.onUpdate);
    if (typeof window !== 'undefined') { window.addEventListener('offline', this.onOffline); window.addEventListener('online', this.onOnline); }
    this.sessionTimer = setInterval(() => {
      const next = getStoredSessionToken();
      if (next === this.token) return;
      if (!next) { this.block('SESSION_REVOKED'); return; }
      void this.refreshAuth(next);
    }, 1000);
    if (this.outbox && this.token) void this.restoreOutbox(this.token); else this.connect();
  }
  private async refreshAuth(next: string) {
    const previous=this.token; if(!previous || next===previous || this.stopped || this.refreshingToken!==null)return;
    this.refreshingToken=next;
    try { await this.queuePersistence(async()=>{
      if(this.outbox)await this.outbox.rebind(previous,next);
      if(this.token!==previous)return;
      // Advance the persistence generation even if the page closed while the atomic
      // rebind was committing. Already queued writes must never recreate the old token.
      this.token=next;
      if(this.stopped)return;
      this.ready=false;this.socket?.close();this.connect('AUTH_REFRESH');
    }); }
    catch { this.block('OUTBOX_WRITE_FAILED',false); return; }
    finally { this.refreshingToken=null; }
  }
  private queuePersistence(operation:()=>Promise<void>):Promise<void>{
    const next=this.persistenceTail.then(operation,operation);
    this.persistenceTail=next.catch(()=>undefined);
    return next;
  }
  private needsReauthorization=false;
  private async restoreOutbox(token: string) {
    try {
      const restored = await this.outbox!.restore(token);
      if (this.stopped || token !== this.token) return;
      if (restored.revoked) { this.needsReauthorization=true;this.pending=[];this.persisted.clear();this.doc.transact(()=>{this.doc.getMap('objects').clear();this.doc.getMap('deletedObjects').clear();},REMOTE);this.connect('FRESH_AUTH_REQUIRED');return; }
      this.pending = restored.updates; this.persisted = new Set(restored.updates.map(item => item.updateId));
      for (const item of restored.updates) Y.applyUpdate(this.doc, base64ToBytes(item.update), REMOTE);
      this.publish({ pending: this.pending.length }); this.connect(restored.updates.length ? 'RESTORED_OUTBOX' : null);
    } catch { this.block('OUTBOX_CORRUPT', false); }
  }
  private publish(patch: Partial<WhiteboardConnectionState>) { this.state = { ...this.state, ...patch, pending: this.pending.length }; this.onState(this.state); }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.stopped) return;
    if (!this.epoch || !['owner','editor'].includes(this.state.role) || this.state.archived) { this.block('WRITE_DENIED'); return; }
    const gestureId=typeof origin==='object'&&origin!==null&&'gestureId' in origin&&typeof origin.gestureId==='string'?origin.gestureId:typeof origin==='object'&&origin!==null&&'receiptGestureId' in origin&&typeof origin.receiptGestureId==='string'?origin.receiptGestureId:crypto.randomUUID();
    const message: Extract<WhiteboardClientMessage, { type: 'update' }> = { type: 'update', epoch: this.epoch, updateId: crypto.randomUUID(), gestureId, update: bytesToBase64(update) };
    const bytes = this.pending.reduce((sum, item) => sum + item.update.length, 0) + message.update.length;
    if (this.pending.length >= WHITEBOARD_SYNC.pendingUpdates || bytes > WHITEBOARD_SYNC.pendingBytes) { this.block('PENDING_LIMIT'); return; }
    this.pending.push(message); this.publish({});
    if(!this.outbox){this.persisted.add(message.updateId);this.drain();return;}
    void this.queuePersistence(async()=>{const token=this.token;if(!token)throw new Error('SESSION_CHANGED');await this.outbox!.persist(token,message);this.persisted.add(message.updateId);if(this.ready&&!this.stopped&&this.refreshingToken===null&&this.token===token&&this.pending.some(item=>item.updateId===message.updateId))this.drain();})
      .catch(() => this.block('OUTBOX_WRITE_FAILED', false));
  };
  private send(message: WhiteboardClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private drain() {
    if (!this.ready || this.stopped || this.refreshingToken !== null) return;
    for (const message of this.pending) {
      if (this.inFlight.size >= OUTBOUND_UPDATE_WINDOW) break;
      if (this.inFlight.has(message.updateId)) continue;
      if (!this.persisted.has(message.updateId)) break;
      if (this.socket?.readyState !== WebSocket.OPEN) break;
      this.send(message); this.inFlight.add(message.updateId);
    }
  }
  private schedulePresence() {
    if (this.presenceTimer || !this.latestPresence) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (!this.ready || this.stopped || this.pending.length || !this.latestPresence) return;
      const message = this.latestPresence; this.latestPresence = null; this.send(message);
    }, 50);
  }
  private onOffline = () => {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.handshake) clearTimeout(this.handshake);
    // Browser offline mode does not reliably close an existing WebSocket.
    // Detach it before closing so a delayed close cannot schedule a stale retry.
    const socket = this.socket; this.socket = null; this.ready = false; this.inFlight.clear();
    this.publish({ phase: 'offline', peers: [], reason: 'CONNECTION_LOST' });
    socket?.close();
  };
  private onOnline = () => { if (!this.stopped) this.retryNow(); };
  private connect(reason: string | null = null) {
    if (this.stopped) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.publish({ phase: 'offline', reason: 'CONNECTION_LOST' }); return; }
    if (!this.token || getStoredSessionToken() !== this.token) { this.block('SESSION_CHANGED'); return; }
    this.ready = false; this.inFlight.clear(); this.publish({ phase: this.epoch ? 'offline' : 'connecting', reason, retryAttempt: this.retry });
    const socket = new WebSocket(apiWebSocketUrl(WHITEBOARD_SYNC.path.replace(':boardId', encodeURIComponent(this.boardId))), [WHITEBOARD_SYNC.protocol, WHITEBOARD_SYNC.bearerSubprotocolPrefix + this.token]);
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(), 10000);
    socket.onopen = () => this.send({ type: 'hello', stateVector: bytesToBase64(Y.encodeStateVector(this.doc)), ...(this.epoch && this.seq !== null ? { resume: { epoch: this.epoch, seq: this.seq } } : {}) });
    let reauthorizing=false;const deferredMessages:MessageEvent[]=[];
    const handleMessage = (event:MessageEvent) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const message = WhiteboardServerMessage.parse(JSON.parse(String(event.data)));
        if (message.type === 'error') {
          if (message.recoverable) { this.retryableClose.add(socket); this.publish({ phase: 'offline', reason: message.code }); socket.close(); return; }
          this.block(message.code); return;
        }
        if (message.type === 'sync' && this.needsReauthorization) {
          if(!this.outbox?.reauthorize||!this.token){this.block('OUTBOX_REVOKED',false);return;}
          reauthorizing=true;const token=this.token;
          void this.queuePersistence(()=>this.outbox!.reauthorize!(token)).then(()=>{
            if(this.stopped||this.socket!==socket||this.token!==token)return;
            this.needsReauthorization=false;reauthorizing=false;handleMessage(event);
            for(const deferred of deferredMessages.splice(0))handleMessage(deferred);
          }).catch(()=>this.block('OUTBOX_REAUTHORIZATION_FAILED',false));return;
        }
        if (message.type === 'sync') {
          if (this.epoch !== null && this.epoch !== message.epoch) { this.block('STALE_EPOCH'); return; }
          if (this.seq !== null && message.seq < this.seq) { this.block('STALE_SEQUENCE'); return; }
          if ((!['owner','editor'].includes(message.role) || message.archived) && this.pending.length) { this.block('WRITE_DENIED'); return; }
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE); this.epoch = message.epoch; this.seq = message.seq; this.ready = true; this.retry = 0;
          if (this.handshake) clearTimeout(this.handshake);
          this.publish({ phase: 'online', role: message.role, archived: message.archived, reason: null, retryAttempt: 0 });
          this.inFlight.clear(); this.drain(); if (!this.pending.length) this.schedulePresence();
        } else if (message.type === 'update') {
          if (!this.ready || message.epoch !== this.epoch) { this.block('STALE_EPOCH'); return; }
          if (this.seq !== null && message.seq <= this.seq) return;
          Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
          this.seq = message.seq;
        } else if (message.type === 'ack') {
          if (!this.ready) { this.block('PROTOCOL_ERROR'); return; }
          const index = this.pending.findIndex(item => item.updateId === message.updateId);
          const receiptKey=`${message.updateId}:${message.gestureId}`;
          if (index < 0 || this.pending[index]?.gestureId!==message.gestureId) {
            if (this.acked.has(receiptKey)) { this.publish({ duplicateAcks: this.state.duplicateAcks + 1, lastAckSequence: message.seq }); return; }
            this.block('ACK_CONFLICT'); return;
          }
          if (!this.inFlight.has(message.updateId)) { this.block('ACK_CONFLICT'); return; }
          this.pending.splice(index, 1); this.inFlight.delete(message.updateId); this.persisted.delete(message.updateId); this.acked.add(receiptKey);
          if (this.outbox) void this.queuePersistence(async()=>{const token=this.token;if(!token)throw new Error('SESSION_CHANGED');await this.outbox!.acknowledge(token,message.updateId);}).catch(()=>this.block('OUTBOX_WRITE_FAILED',false));
          while (this.acked.size > WHITEBOARD_SYNC.pendingUpdates) this.acked.delete(this.acked.values().next().value!);
          this.publish({ lastAckSequence: message.seq, lastAckReceipt:{updateId:message.updateId,gestureId:message.gestureId,seq:message.seq} });
          this.drain(); if (!this.pending.length) this.schedulePresence();
        } else if (message.type === 'recovery') {
          if (message.disposition === 'access-revoked') { this.block('ACCESS_REVOKED'); return; }
          if (message.disposition === 'board-archived') { this.block('BOARD_ARCHIVED'); return; }
          if (message.disposition === 'reload-required') { this.block(message.code); return; }
          if (message.disposition === 'retry-later') { this.retryableClose.add(socket); socket.close(); this.publish({ phase: 'offline', reason: message.code }); return; }
          this.publish({ reason: null });
        } else if (message.type === 'presence') this.publish({ peers: message.peers });
      } catch { this.block('PROTOCOL_ERROR'); }
    };
    socket.onmessage=event=>{if(reauthorizing){if(deferredMessages.length>=WHITEBOARD_SYNC.pendingUpdates){this.block('PROTOCOL_ERROR');return;}deferredMessages.push(event);}else handleMessage(event);};
    socket.onclose = event => {
      if (this.handshake) clearTimeout(this.handshake);
      if (this.stopped || this.socket !== socket) return;
      this.ready = false; this.inFlight.clear();
      if ([1008, 4001, 4003, 4401, 4403].includes(event.code) && !this.retryableClose.has(socket)) { this.block('ACCESS_DENIED'); return; }
      const delay = Math.min(15000, 500 * 2 ** Math.min(this.retry++, 5));
      this.publish({ phase: 'offline', peers: [], reason: this.state.reason ?? 'CONNECTION_LOST', retryAttempt: this.retry });
      this.timer = setTimeout(() => this.connect('RETRYING'), delay);
    };
    socket.onerror = () => socket.close();
  }
  awareness(cursor: { x: number; y: number } | null, selected: string[], editingObjectId: string | null = null, collaboration?: {viewport:{centerX:number;centerY:number;zoom:number;revision:number};presenting:boolean;followingActorId:string|null}) {
    if (!this.ready || this.stopped || (cursor && (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)))) return;
    this.latestPresence = { type: 'awareness', cursor, selected: selected.slice(0,200), editingObjectId,viewport:collaboration?.viewport??null,presenting:collaboration?.presenting??false,followingActorId:collaboration?.followingActorId??null };
    this.schedulePresence();
  }
  retryNow() { if (this.stopped || this.state.phase === 'blocked') return; if (this.timer) clearTimeout(this.timer); this.retry = 0; this.socket?.close(); this.connect('MANUAL_RETRY'); }
  private block(reason: string, persistRevocation = ['ACCESS_REVOKED','ACCESS_DENIED','SESSION_REVOKED'].includes(reason)) {
    if (this.stopped) return;
    const token=this.token,outbox=this.outbox;
    this.close(!persistRevocation); if (persistRevocation) { this.pending = []; this.persisted.clear(); }
    // Hide and remove locally visible content after access loss; no clear update is sent.
    this.doc.transact(() => { this.doc.getMap('objects').clear(); this.doc.getMap('deletedObjects').clear(); }, REMOTE);
    this.publish({ phase: 'blocked', role: 'viewer', peers: [], reason });
    if (persistRevocation && token && outbox) void outbox.revoke(token).finally(()=>outbox.close());
  }
  close(closeOutbox = true) { if (typeof window !== 'undefined') { window.removeEventListener('offline', this.onOffline); window.removeEventListener('online', this.onOnline); } if (this.presenceTimer) clearTimeout(this.presenceTimer); this.stopped = true; this.ready = false; this.inFlight.clear(); if (this.timer) clearTimeout(this.timer); if (this.handshake) clearTimeout(this.handshake); clearInterval(this.sessionTimer); this.doc.off('update', this.onUpdate); this.socket?.close(); if(closeOutbox)this.outbox?.close(); }
}
