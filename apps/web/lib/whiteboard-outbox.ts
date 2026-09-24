import { WHITEBOARD_SYNC, WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';

export type PendingWhiteboardUpdate = Extract<WhiteboardClientMessage, { type: 'update' }>;

export type WhiteboardOutboxContext = {
  boardId: string;
  principalId: string;
  sessionId: string;
};

export type WhiteboardOutboxScope = WhiteboardOutboxContext & { epoch: number };

export type WhiteboardQuarantineReceipt = WhiteboardOutboxScope & {
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
const memoryRevocations=new Set<string>();

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

type RevokedSession = { principalId: string; sessionId: string };
const revokedId = (identity: RevokedSession) => JSON.stringify([identity.principalId, identity.sessionId]);
function revokedSessions(): RevokedSession[] {
  const entries = new Map<string, RevokedSession>();
  for (const encoded of memoryRevocations) {
    const [principalId, sessionId] = JSON.parse(encoded) as [string, string];
    entries.set(encoded, { principalId, sessionId });
  }
  if (typeof localStorage !== 'undefined') try {
    const stored = JSON.parse(localStorage.getItem(REVOKED_STORAGE_KEY) ?? '[]') as unknown;
    for (const item of Array.isArray(stored) ? stored : []) if (item && typeof item === 'object'
      && typeof (item as RevokedSession).principalId === 'string' && typeof (item as RevokedSession).sessionId === 'string') {
      entries.set(revokedId(item as RevokedSession), item as RevokedSession);
    }
  } catch { /* malformed storage remains fail closed through memory revocations */ }
  return [...entries.values()];
}
function markRevoked(identity: RevokedSession): void {
  memoryRevocations.add(revokedId(identity));
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
  return revoked.some(identity => identity.principalId === scope.principalId && identity.sessionId === scope.sessionId);
}

async function cleanupRevokedSessions(database: IDBDatabase): Promise<void> {
  const revoked = revokedSessions();
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

async function openDatabase(): Promise<IDBDatabase> {
  const opened = indexedDB.open(DB_NAME, DB_VERSION);
  opened.onupgradeneeded = () => {
    const database = opened.result;
    database.createObjectStore(ACTIVE, { keyPath: 'id' });
    database.createObjectStore(QUARANTINE, { keyPath: 'receiptId' });
  };
  const database=await request(opened);
  try{await cleanupRevokedSessions(database);return database;}catch(error){database.close();throw error;}
}

async function readActive(database: IDBDatabase, id: string): Promise<StoredOutbox | undefined> {
  const transaction = database.transaction(ACTIVE, 'readonly');
  const result = await request(transaction.objectStore(ACTIVE).get(id)) as StoredOutbox | undefined;
  await complete(transaction);
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
      const database = await openDatabase();
      try {
        const row = await readActive(database, scopeId(scope));
        if (!row) return [];
        const updates: PendingWhiteboardUpdate[] = [];
        for (const entry of row.entries) {
          const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv, additionalData: additionalData(scope, entry.updateId) }, row.key, entry.value);
          const parsed = WhiteboardClientMessage.safeParse(JSON.parse(new TextDecoder().decode(clear)));
          if (!parsed.success || parsed.data.type !== 'update' || parsed.data.epoch !== scope.epoch || parsed.data.updateId !== entry.updateId) throw new Error('WHITEBOARD_OUTBOX_CORRUPT');
          updates.push(parsed.data);
        }
        return updates;
      } finally { database.close(); }
    });
  }

  async summarize(context: WhiteboardOutboxContext): Promise<WhiteboardOutboxSummary> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(ACTIVE, 'readonly');
        const rows = await request(transaction.objectStore(ACTIVE).getAll()) as StoredOutbox[];
        await complete(transaction);
        return rows.filter(row => sameContext(row, context)).reduce((summary, row) => ({
          pendingCount: summary.pendingCount + row.entries.length,
          pendingBytes: summary.pendingBytes + row.entries.reduce((sum, entry) => sum + entry.plainBytes, 0),
        }), { pendingCount: 0, pendingBytes: 0 });
      } finally { database.close(); }
    });
  }

  async put(scope: WhiteboardOutboxScope, update: PendingWhiteboardUpdate): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
      try {
        const id = scopeId(scope);
        const existing = await readActive(database, id);
        if (existing?.entries.some(item => item.updateId === update.updateId)) return;
        const entries = existing?.entries ?? [];
        const pendingBytes = entries.reduce((sum, item) => sum + item.plainBytes, 0) + update.update.length;
        if (entries.length >= WHITEBOARD_SYNC.pendingUpdates || pendingBytes > WHITEBOARD_SYNC.pendingBytes) throw new WhiteboardOutboxLimitError();
        const key = existing?.key ?? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12)).slice().buffer;
        const clear = new TextEncoder().encode(JSON.stringify(update));
        const value = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(scope, update.updateId) }, key, clear);
        const transaction = database.transaction(ACTIVE, 'readwrite');
        transaction.objectStore(ACTIVE).put({ ...scope, id, key, entries: [...entries, { updateId: update.updateId, iv, value, plainBytes: update.update.length }] } satisfies StoredOutbox);
        await complete(transaction);
      } finally { database.close(); }
    });
  }

  async ack(scope: WhiteboardOutboxScope, updateId: string): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
      try {
        const id = scopeId(scope);
        const existing = await readActive(database, id);
        if (!existing) return;
        const entries = existing.entries.filter(item => item.updateId !== updateId);
        const transaction = database.transaction(ACTIVE, 'readwrite');
        if (entries.length) transaction.objectStore(ACTIVE).put({ ...existing, entries });
        else transaction.objectStore(ACTIVE).delete(id);
        await complete(transaction);
      } finally { database.close(); }
    });
  }

  async quarantineExcept(context: WhiteboardOutboxContext, keepEpoch: number | null, reason: string): Promise<WhiteboardQuarantineReceipt[]> {
    return this.quarantineWhere(row => sameContext(row, context) && row.epoch !== keepEpoch, reason);
  }

  async quarantineSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, reason: string): Promise<WhiteboardQuarantineReceipt[]> {
    return this.quarantineWhere(row => row.principalId === identity.principalId && row.sessionId === identity.sessionId, reason);
  }

  async listQuarantine(identity:Pick<WhiteboardOutboxContext,'principalId'>,boardId?:string):Promise<WhiteboardQuarantineReceipt[]>{
    return withOutboxLock(async()=>{const database=await openDatabase();try{const transaction=database.transaction(QUARANTINE,'readonly');const rows=await request(transaction.objectStore(QUARANTINE).getAll()) as StoredQuarantine[];await complete(transaction);return rows.filter(row=>row.principalId===identity.principalId&&(!boardId||row.boardId===boardId)).map(({ciphertext:_,...receipt})=>receipt);}finally{database.close();}});
  }

  async discardQuarantine(identity: Pick<WhiteboardOutboxContext, 'principalId'>, receiptId: string): Promise<boolean> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(QUARANTINE, 'readwrite');
        const store = transaction.objectStore(QUARANTINE);
        const row = await request(store.get(receiptId)) as StoredQuarantine | undefined;
        if (!row || row.principalId !== identity.principalId) {
          await complete(transaction);
          return false;
        }
        store.delete(receiptId);
        await complete(transaction);
        return true;
      } finally { database.close(); }
    });
  }

  async purgeSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>): Promise<void> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
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

  private async quarantineWhere(matches: (row: StoredOutbox) => boolean, reason: string): Promise<WhiteboardQuarantineReceipt[]> {
    return withOutboxLock(async () => {
      const database = await openDatabase();
      try {
        const read = database.transaction(ACTIVE, 'readonly');
        const rows = await request(read.objectStore(ACTIVE).getAll()) as StoredOutbox[];
        await complete(read);
        const selected = rows.filter(matches);
        if (!selected.length) return [];
        const now = new Date().toISOString();
        const receipts = selected.map(row => ({
          boardId: row.boardId, principalId: row.principalId, sessionId: row.sessionId, epoch: row.epoch,
          receiptId: crypto.randomUUID(), reason, quarantinedAt: now,
          pendingCount: row.entries.length,
          pendingBytes: row.entries.reduce((sum, entry) => sum + entry.plainBytes, 0),
        } satisfies WhiteboardQuarantineReceipt));
        const write = database.transaction([ACTIVE, QUARANTINE], 'readwrite');
        selected.forEach((row, index) => {
          write.objectStore(QUARANTINE).put({ ...receipts[index]!, ciphertext: row.entries } satisfies StoredQuarantine);
          write.objectStore(ACTIVE).delete(row.id);
        });
        await complete(write);
        return receipts;
      } finally { database.close(); }
    });
  }
}

export async function fingerprintWhiteboardSession(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Global logout boundary: leaves a synchronous tombstone, then best-effort purges this session. */
export async function revokeWhiteboardSession(principalId: string, token: string): Promise<WhiteboardQuarantineReceipt[]> {
  if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined') return [];
  const sessionId=await fingerprintWhiteboardSession(token);
  markRevoked({principalId,sessionId});
  const outbox=new IndexedDbWhiteboardOutbox();
  try{await outbox.purgeSession({principalId,sessionId});}catch{/* tombstone makes every later open/load/put fail closed until cleanup succeeds */}
  return [];
}

export const WHITEBOARD_REVOKED_SESSION_STORAGE_KEY=REVOKED_STORAGE_KEY;
