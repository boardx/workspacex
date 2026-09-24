import { WHITEBOARD_SYNC, WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';

export type PendingWhiteboardUpdate = Extract<WhiteboardClientMessage, { type: 'update' }>;

export type WhiteboardOutboxContext = {
  boardId: string;
  principalId: string;
  sessionId: string;
};

export type WhiteboardOutboxScope = WhiteboardOutboxContext & { epoch: number; accessReceiptId: string };

export type WhiteboardQuarantineReceipt = WhiteboardOutboxContext & {
  epoch: number;
  /** Missing on records written before authenticated recovery proofs existed. */
  accessReceiptId?: string;
  receiptId: string;
  reason: string;
  quarantinedAt: string;
  pendingCount: number;
  pendingBytes: number;
};

export type WhiteboardOutboxSummary = { pendingCount: number; pendingBytes: number };

export interface WhiteboardOutboxPort {
  load(scope: WhiteboardOutboxScope): Promise<PendingWhiteboardUpdate[]>;
  summarize(context: WhiteboardOutboxContext): Promise<WhiteboardOutboxSummary>;
  put(scope: WhiteboardOutboxScope, update: PendingWhiteboardUpdate): Promise<void>;
  ack(scope: WhiteboardOutboxScope, updateId: string): Promise<void>;
  quarantineExcept(context: WhiteboardOutboxContext, keepEpoch: number | null, reason: string): Promise<WhiteboardQuarantineReceipt[]>;
  quarantineSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, reason: string): Promise<WhiteboardQuarantineReceipt[]>;
  listQuarantine(identity: Pick<WhiteboardOutboxContext, 'principalId'>, boardId?: string): Promise<WhiteboardQuarantineReceipt[]>;
  discardQuarantine(identity: Pick<WhiteboardOutboxContext, 'principalId'>, receiptId: string): Promise<boolean>;
  purgeSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>): Promise<void>;
}

export class WhiteboardOutboxLimitError extends Error {
  constructor() { super('WHITEBOARD_OUTBOX_LIMIT'); this.name = 'WhiteboardOutboxLimitError'; }
}

type Ciphertext = { updateId: string; iv: ArrayBuffer; value: ArrayBuffer; plainBytes: number };
type StoredOutbox = WhiteboardOutboxScope & { id: string; key: CryptoKey; entries: Ciphertext[] };
type StoredQuarantine = WhiteboardQuarantineReceipt & { ciphertext: Ciphertext[] };

const DB_NAME = 'workspacex-whiteboard-outbox';
const DB_VERSION = 1;
const ACTIVE = 'active';
const QUARANTINE = 'quarantine';
const LOCK_NAME = 'workspacex-whiteboard-outbox';
const REVOKED_STORAGE_KEY='workspacex-whiteboard-revoked-sessions';
let localLock: Promise<void> = Promise.resolve();
const memoryRevocations=new Map<string,RevokedSession>();
let revocationAttemptSequence=0;

export const WHITEBOARD_OUTBOX_STORAGE = { database: DB_NAME, version: DB_VERSION, activeStore: ACTIVE, quarantineStore: QUARANTINE } as const;

async function withOutboxLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(LOCK_NAME, work);
  const previous = localLock;
  let release: (() => void) | undefined;
  localLock = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release?.(); }
}

function scopeId(scope: WhiteboardOutboxScope): string {
  return JSON.stringify([scope.boardId, scope.principalId, scope.sessionId, scope.epoch]);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('INDEXED_DB_REQUEST_FAILED'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('INDEXED_DB_TRANSACTION_FAILED'));
    transaction.onabort = () => reject(transaction.error ?? new Error('INDEXED_DB_TRANSACTION_ABORTED'));
  });
}

type RevokedSession = { principalId: string; sessionId: string; attemptId?: never }
  | { principalId: string; sessionId: null; attemptId: string };
const revokedId = (identity: RevokedSession) => identity.sessionId===null
  ? JSON.stringify([identity.principalId,null,identity.attemptId])
  : JSON.stringify([identity.principalId,identity.sessionId]);
function revokedSessions(): RevokedSession[] {
  const entries = new Map<string, RevokedSession>();
  for (const [encoded,identity] of memoryRevocations) entries.set(encoded,identity);
  if (typeof localStorage !== 'undefined') try {
    const stored = JSON.parse(localStorage.getItem(REVOKED_STORAGE_KEY) ?? '[]') as unknown;
    for (const item of Array.isArray(stored) ? stored : []) if (item && typeof item === 'object') {
      const candidate=item as Partial<RevokedSession>;
      if(typeof candidate.principalId!=='string')continue;
      const identity:RevokedSession|null=typeof candidate.sessionId==='string'
        ? {principalId:candidate.principalId,sessionId:candidate.sessionId}
        : candidate.sessionId===null
          ? {principalId:candidate.principalId,sessionId:null,attemptId:typeof candidate.attemptId==='string'?candidate.attemptId:'legacy'}
          : null;
      if(identity)entries.set(revokedId(identity),identity);
    }
  } catch { /* malformed storage remains fail closed through memory revocations */ }
  return [...entries.values()];
}
function markRevoked(identity: RevokedSession): void {
  memoryRevocations.set(revokedId(identity),identity);
  if (typeof localStorage !== 'undefined') try {
    const current = revokedSessions();
    if (!current.some(item => revokedId(item) === revokedId(identity))) current.push(identity);
    localStorage.setItem(REVOKED_STORAGE_KEY, JSON.stringify(current));
  } catch { /* memory tombstone remains authoritative for this page */ }
}
function clearRevoked(identities: RevokedSession[]): void {
  for (const identity of identities) memoryRevocations.delete(revokedId(identity));
  if (typeof localStorage !== 'undefined') try {
    const removed = new Set(identities.map(revokedId));
    localStorage.setItem(REVOKED_STORAGE_KEY, JSON.stringify(revokedSessions().filter(identity => !removed.has(revokedId(identity)))));
  } catch { /* already purged; a stale disk tombstone is safe and retries later */ }
}
function isRevoked(scope: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, revoked: RevokedSession[]): boolean {
  return revoked.some(identity => identity.principalId === scope.principalId
    && (identity.sessionId === null || identity.sessionId === scope.sessionId));
}
function assertNotRevoked(scope:Pick<WhiteboardOutboxContext,'principalId'|'sessionId'>):void{
  if(isRevoked(scope,revokedSessions()))throw new Error('WHITEBOARD_SESSION_REVOKED');
}
function assertPrincipalNotBroadRevoked(principalId:string):void{
  if(revokedSessions().some(identity=>identity.principalId===principalId&&identity.sessionId===null))throw new Error('WHITEBOARD_SESSION_REVOKED');
}

async function cleanupRevokedSessions(database: IDBDatabase): Promise<void> {
  // Broad markers belong to an individual logout attempt. Only that attempt may narrow and
  // clear its marker; database cleanup must never erase another in-flight logout's protection.
  const revoked = revokedSessions().filter((identity):identity is Extract<RevokedSession,{sessionId:string}>=>identity.sessionId!==null);
  if (!revoked.length) return;
  const transaction = database.transaction([ACTIVE, QUARANTINE], 'readwrite');
  const activeStore = transaction.objectStore(ACTIVE), quarantineStore = transaction.objectStore(QUARANTINE);
  const [active, quarantined] = await Promise.all([
    request(activeStore.getAll()) as Promise<StoredOutbox[]>,
    request(quarantineStore.getAll()) as Promise<StoredQuarantine[]>,
  ]);
  for (const row of active) if (isRevoked(row, revoked)) activeStore.delete(row.id);
  for (const row of quarantined) if (isRevoked(row, revoked)) quarantineStore.delete(row.receiptId);
  await complete(transaction);
  clearRevoked(revoked);
}

async function openDatabase(principalId: string): Promise<IDBDatabase> {
  const hasBroadRevocation=()=>revokedSessions().some(identity=>identity.principalId===principalId&&identity.sessionId===null);
  if(hasBroadRevocation())throw new Error('WHITEBOARD_SESSION_REVOKED');
  const opened = indexedDB.open(DB_NAME, DB_VERSION);
  opened.onupgradeneeded = () => {
    const database = opened.result;
    database.createObjectStore(ACTIVE, { keyPath: 'id' });
    database.createObjectStore(QUARANTINE, { keyPath: 'receiptId' });
  };
  const database=await request(opened);
  // A principal-wide logout marker is written before asynchronous fingerprinting. Do not read
  // any persisted CryptoKey until it has been narrowed to the revoked session and cleaned.
  if (hasBroadRevocation()) {
    database.close();
    throw new Error('WHITEBOARD_SESSION_REVOKED');
  }
  try{await cleanupRevokedSessions(database);return database;}catch(error){database.close();throw error;}
}

async function readActive(database: IDBDatabase, scope: WhiteboardOutboxScope): Promise<StoredOutbox | undefined> {
  const transaction = database.transaction(ACTIVE, 'readonly');
  const result = await request(transaction.objectStore(ACTIVE).get(scopeId(scope))) as StoredOutbox | undefined;
  assertNotRevoked(scope);
  await complete(transaction);
  assertNotRevoked(scope);
  return result;
}

function sameContext(row: StoredOutbox, context: WhiteboardOutboxContext): boolean {
  return row.boardId === context.boardId && row.principalId === context.principalId && row.sessionId === context.sessionId;
}

function additionalData(scope: WhiteboardOutboxScope, updateId: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.boardId, scope.principalId, scope.sessionId, scope.epoch, updateId]));
  return bytes.slice().buffer;
}

/**
 * Browser-owned durable queue. Payloads are AES-GCM ciphertext and the non-extractable key is
 * structured-cloned by IndexedDB. Revocation moves ciphertext to a separate store and omits the
 * key, making the receipt auditable without retaining a replay or export path.
 */
export class IndexedDbWhiteboardOutbox implements WhiteboardOutboxPort {
  async load(scope: WhiteboardOutboxScope): Promise<PendingWhiteboardUpdate[]> {
    return withOutboxLock(async () => {
      const database = await openDatabase(scope.principalId);
      try {
        const row = await readActive(database, scope);
        if (!row) return [];
        const updates: PendingWhiteboardUpdate[] = [];
        for (const entry of row.entries) {
          assertNotRevoked(scope);
          const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv, additionalData: additionalData(scope, entry.updateId) }, row.key, entry.value);
          assertNotRevoked(scope);
          const parsed = WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(clear)));
          if (!parsed.success || parsed.data.type !== 'update' || parsed.data.epoch !== scope.epoch || parsed.data.updateId !== entry.updateId) throw new Error('WHITEBOARD_OUTBOX_CORRUPT');
          assertNotRevoked(scope);
          updates.push(parsed.data);
        }
        assertNotRevoked(scope);
        return updates;
      } finally { database.close(); }
    });
  }

  async summarize(context: WhiteboardOutboxContext): Promise<WhiteboardOutboxSummary> {
    return withOutboxLock(async () => {
      const database = await openDatabase(context.principalId);
      try {
        const transaction = database.transaction(ACTIVE, 'readonly');
        const rows = await request(transaction.objectStore(ACTIVE).getAll()) as StoredOutbox[];
        assertNotRevoked(context);
        await complete(transaction);
        assertNotRevoked(context);
        const summary=rows.filter(row => sameContext(row, context)).reduce((value, row) => ({
          pendingCount: value.pendingCount + row.entries.length,
          pendingBytes: value.pendingBytes + row.entries.reduce((sum, entry) => sum + entry.plainBytes, 0),
        }), { pendingCount: 0, pendingBytes: 0 });
        assertNotRevoked(context);return summary;
      } finally { database.close(); }
    });
  }

  async put(scope: WhiteboardOutboxScope, update: PendingWhiteboardUpdate): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase(scope.principalId);
      try {
        const id = scopeId(scope);
        const existing = await readActive(database, scope);
        if (existing?.entries.some(item => item.updateId === update.updateId)) return;
        const entries = existing?.entries ?? [];
        const pendingBytes = entries.reduce((sum, item) => sum + item.plainBytes, 0) + update.update.length;
        if (entries.length >= WHITEBOARD_SYNC.pendingUpdates || pendingBytes > WHITEBOARD_SYNC.pendingBytes) throw new WhiteboardOutboxLimitError();
        assertNotRevoked(scope);
        const key = existing?.key ?? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        assertNotRevoked(scope);
        const iv = crypto.getRandomValues(new Uint8Array(12)).slice().buffer;
        const clear = new TextEncoder().encode(JSON.stringify(update));
        assertNotRevoked(scope);
        const value = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(scope, update.updateId) }, key, clear);
        assertNotRevoked(scope);
        const transaction = database.transaction(ACTIVE, 'readwrite');
        assertNotRevoked(scope);
        transaction.objectStore(ACTIVE).put({ ...scope, id, key, entries: [...entries, { updateId: update.updateId, iv, value, plainBytes: update.update.length }] } satisfies StoredOutbox);
        await complete(transaction);
        assertNotRevoked(scope);
      } finally { database.close(); }
    });
  }

  async ack(scope: WhiteboardOutboxScope, updateId: string): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase(scope.principalId);
      try {
        const id = scopeId(scope);
        const existing = await readActive(database, scope);
        if (!existing) return;
        const entries = existing.entries.filter(item => item.updateId !== updateId);
        const transaction = database.transaction(ACTIVE, 'readwrite');
        assertNotRevoked(scope);
        if (entries.length) transaction.objectStore(ACTIVE).put({ ...existing, entries });
        else transaction.objectStore(ACTIVE).delete(id);
        await complete(transaction);
        assertNotRevoked(scope);
      } finally { database.close(); }
    });
  }

  async quarantineExcept(context: WhiteboardOutboxContext, keepEpoch: number | null, reason: string): Promise<WhiteboardQuarantineReceipt[]> {
    return this.quarantineWhere(row => sameContext(row, context) && row.epoch !== keepEpoch, reason,context.principalId);
  }

  async quarantineSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, reason: string): Promise<WhiteboardQuarantineReceipt[]> {
    return this.quarantineWhere(row => row.principalId === identity.principalId && row.sessionId === identity.sessionId, reason,identity.principalId);
  }

  async listQuarantine(identity:Pick<WhiteboardOutboxContext,'principalId'>,boardId?:string):Promise<WhiteboardQuarantineReceipt[]>{
    return withOutboxLock(async()=>{const database=await openDatabase(identity.principalId);try{const transaction=database.transaction(QUARANTINE,'readonly');const rows=await request(transaction.objectStore(QUARANTINE).getAll()) as StoredQuarantine[];assertPrincipalNotBroadRevoked(identity.principalId);await complete(transaction);assertPrincipalNotBroadRevoked(identity.principalId);return rows.filter(row=>row.principalId===identity.principalId&&(!boardId||row.boardId===boardId)).map(({ciphertext:_,...receipt})=>receipt);}finally{database.close();}});
  }

  async discardQuarantine(identity: Pick<WhiteboardOutboxContext, 'principalId'>, receiptId: string): Promise<boolean> {
    return withOutboxLock(async () => {
      const database = await openDatabase(identity.principalId);
      try {
        const transaction = database.transaction(QUARANTINE, 'readwrite');
        const store = transaction.objectStore(QUARANTINE);
        const row = await request(store.get(receiptId)) as StoredQuarantine | undefined;
        assertPrincipalNotBroadRevoked(identity.principalId);
        if (!row || row.principalId !== identity.principalId) {
          await complete(transaction);
          return false;
        }
        assertNotRevoked(row);
        store.delete(receiptId);
        await complete(transaction);
        assertNotRevoked(row);
        return true;
      } finally { database.close(); }
    });
  }

  async purgeSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase(identity.principalId);
      try {
        const transaction = database.transaction([ACTIVE, QUARANTINE], 'readwrite');
        const activeStore = transaction.objectStore(ACTIVE), quarantineStore = transaction.objectStore(QUARANTINE);
        const [active, quarantine] = await Promise.all([
          request(activeStore.getAll()) as Promise<StoredOutbox[]>,
          request(quarantineStore.getAll()) as Promise<StoredQuarantine[]>,
        ]);
        for (const row of active) if (row.principalId === identity.principalId && row.sessionId === identity.sessionId) activeStore.delete(row.id);
        for (const row of quarantine) if (row.principalId === identity.principalId && row.sessionId === identity.sessionId) quarantineStore.delete(row.receiptId);
        await complete(transaction);
      } finally { database.close(); }
    });
  }

  private async quarantineWhere(matches: (row: StoredOutbox) => boolean, reason: string,principalId:string): Promise<WhiteboardQuarantineReceipt[]> {
    return withOutboxLock(async () => {
      const database = await openDatabase(principalId);
      try {
        const read = database.transaction(ACTIVE, 'readonly');
        const rows = await request(read.objectStore(ACTIVE).getAll()) as StoredOutbox[];
        assertPrincipalNotBroadRevoked(principalId);
        await complete(read);
        assertPrincipalNotBroadRevoked(principalId);
        const selected = rows.filter(matches);
        if (!selected.length) return [];
        for(const row of selected)assertNotRevoked(row);
        const now = new Date().toISOString();
        const receipts = selected.map(row => ({
          boardId: row.boardId, principalId: row.principalId, sessionId: row.sessionId, epoch: row.epoch,
          ...(row.accessReceiptId ? {accessReceiptId:row.accessReceiptId} : {}),
          receiptId: crypto.randomUUID(), reason, quarantinedAt: now,
          pendingCount: row.entries.length,
          pendingBytes: row.entries.reduce((sum, entry) => sum + entry.plainBytes, 0),
        } satisfies WhiteboardQuarantineReceipt));
        const write = database.transaction([ACTIVE, QUARANTINE], 'readwrite');
        for(const row of selected)assertNotRevoked(row);
        selected.forEach((row, index) => {
          write.objectStore(QUARANTINE).put({ ...receipts[index]!, ciphertext: row.entries } satisfies StoredQuarantine);
          write.objectStore(ACTIVE).delete(row.id);
        });
        await complete(write);
        for(const row of selected)assertNotRevoked(row);
        return receipts;
      } finally { database.close(); }
    });
  }
}

export async function fingerprintWhiteboardSession(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Writes the logout boundary synchronously; fingerprinting and physical cleanup are detached. */
export function markWhiteboardSessionRevoked(principalId: string, token: string): void {
  const attemptId=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'
    ? crypto.randomUUID()
    : `${Date.now()}-${++revocationAttemptSequence}`;
  const broad={principalId,sessionId:null,attemptId} satisfies RevokedSession;
  markRevoked(broad);
  if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined') return;
  // The principal marker above blocks every CryptoKey path before Web Crypto, Web Locks or
  // IndexedDB can stall. Only a completed digest narrows that marker to this bearer session.
  const sessionId=Promise.race([
    fingerprintWhiteboardSession(token).catch(()=>null),
    new Promise<null>(resolve=>setTimeout(()=>resolve(null),2_000)),
  ]);
  void sessionId.then(value=>{
    if(!value)return;
    const exact={principalId,sessionId:value};
    markRevoked(exact);
    clearRevoked([broad]);
    const cleanup=new IndexedDbWhiteboardOutbox().purgeSession(exact);
    void Promise.race([
      cleanup.catch(()=>undefined),
      new Promise<void>(resolve=>setTimeout(resolve,2_000)),
    ]);
  });
}

export const WHITEBOARD_REVOKED_SESSION_STORAGE_KEY=REVOKED_STORAGE_KEY;
