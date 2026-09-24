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

export interface WhiteboardOutboxPort {
  load(scope: WhiteboardOutboxScope): Promise<PendingWhiteboardUpdate[]>;
  put(scope: WhiteboardOutboxScope, update: PendingWhiteboardUpdate): Promise<void>;
  ack(scope: WhiteboardOutboxScope, updateId: string): Promise<void>;
  quarantineExcept(context: WhiteboardOutboxContext, keepEpoch: number | null, reason: string): Promise<WhiteboardQuarantineReceipt[]>;
  quarantineSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, reason: string): Promise<WhiteboardQuarantineReceipt[]>;
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
let localLock: Promise<void> = Promise.resolve();

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

async function openDatabase(): Promise<IDBDatabase> {
  const opened = indexedDB.open(DB_NAME, DB_VERSION);
  opened.onupgradeneeded = () => {
    const database = opened.result;
    database.createObjectStore(ACTIVE, { keyPath: 'id' });
    database.createObjectStore(QUARANTINE, { keyPath: 'receiptId' });
  };
  return request(opened);
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
