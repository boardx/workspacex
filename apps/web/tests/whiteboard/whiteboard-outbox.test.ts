import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { IndexedDbWhiteboardOutbox, WHITEBOARD_OUTBOX_STORAGE, WhiteboardOutboxLimitError, type PendingWhiteboardUpdate, type WhiteboardOutboxScope } from '@/lib/whiteboard-outbox';

function update(epoch: number, value = 'AQID'): PendingWhiteboardUpdate {
  return { type: 'update', epoch, updateId: crypto.randomUUID(), update: value };
}

const scope = (overrides: Partial<WhiteboardOutboxScope> = {}): WhiteboardOutboxScope => ({
  boardId: 'board-1', principalId: 'user-1', sessionId: 'session-1', epoch: 1, ...overrides,
});

async function rows(storeName: string): Promise<Record<string, unknown>[]> {
  const opened = indexedDB.open(WHITEBOARD_OUTBOX_STORAGE.database, WHITEBOARD_OUTBOX_STORAGE.version);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  try {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function replaceActive(row: Record<string, unknown>): Promise<void> {
  const opened = indexedDB.open(WHITEBOARD_OUTBOX_STORAGE.database, WHITEBOARD_OUTBOX_STORAGE.version);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  try {
    const transaction = database.transaction(WHITEBOARD_OUTBOX_STORAGE.activeStore, 'readwrite');
    transaction.objectStore(WHITEBOARD_OUTBOX_STORAGE.activeStore).put(row);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });

it('persists an actual non-extractable CryptoKey and decrypts after reopening the database', async () => {
  const first = new IndexedDbWhiteboardOutbox(), pending = update(1);
  await first.put(scope(), pending);
  const stored = await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore);
  expect(stored).toHaveLength(1);
  const key = stored[0]!.key as CryptoKey;
  expect(key.extractable).toBe(false);
  expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  expect(stored[0]!.entries).toEqual([expect.objectContaining({ updateId: pending.updateId, iv: expect.any(ArrayBuffer), value: expect.any(ArrayBuffer) })]);
  const reopened = new IndexedDbWhiteboardOutbox();
  await expect(reopened.load(scope())).resolves.toEqual([pending]);
  await expect(reopened.load(scope({ principalId: 'user-2' }))).resolves.toEqual([]);
  await expect(reopened.load(scope({ sessionId: 'session-2' }))).resolves.toEqual([]);
  await expect(reopened.load(scope({ epoch: 2 }))).resolves.toEqual([]);
});

it('deletes the active record only after ACK', async () => {
  const adapter = new IndexedDbWhiteboardOutbox(), pending = update(1);
  await adapter.put(scope(), pending);
  expect(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).toHaveLength(1);
  await adapter.ack(scope(), crypto.randomUUID());
  expect(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).toHaveLength(1);
  await adapter.ack(scope(), pending.updateId);
  expect(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).toHaveLength(0);
});

it('atomically moves stale ciphertext to quarantine without copying its key', async () => {
  const adapter = new IndexedDbWhiteboardOutbox();
  const stale = scope({ epoch: 1 }), current = scope({ epoch: 2 }), foreign = scope({ boardId: 'board-2', epoch: 1 });
  await adapter.put(stale, update(1));
  await adapter.put(current, update(2));
  await adapter.put(foreign, update(1));
  const receipts = await adapter.quarantineExcept(scope(), 2, 'STALE_EPOCH');
  expect(receipts).toEqual([expect.objectContaining({ boardId: 'board-1', epoch: 1, pendingCount: 1, reason: 'STALE_EPOCH' })]);
  const active = await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore);
  expect(active).toHaveLength(2);
  expect(active).toEqual(expect.arrayContaining([expect.objectContaining({ boardId: 'board-1', epoch: 2 }), expect.objectContaining({ boardId: 'board-2', epoch: 1 })]));
  const quarantined = await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore);
  expect(quarantined).toHaveLength(1);
  expect(quarantined[0]).not.toHaveProperty('key');
  expect(quarantined[0]).toMatchObject({ boardId: 'board-1', epoch: 1, pendingCount: 1, ciphertext: [expect.objectContaining({ value: expect.any(ArrayBuffer) })] });
  await expect(adapter.load(stale)).resolves.toEqual([]);
});

it('quarantines every board for a logged-out principal/session and leaves other sessions intact', async () => {
  const adapter = new IndexedDbWhiteboardOutbox();
  await adapter.put(scope({ boardId: 'board-1' }), update(1));
  await adapter.put(scope({ boardId: 'board-2' }), update(1));
  await adapter.put(scope({ boardId: 'board-3', sessionId: 'other-session' }), update(1));
  const receipts = await adapter.quarantineSession({ principalId: 'user-1', sessionId: 'session-1' }, 'SESSION_CHANGED');
  expect(receipts.map(receipt => receipt.boardId).sort()).toEqual(['board-1', 'board-2']);
  expect(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).toEqual([expect.objectContaining({ boardId: 'board-3', sessionId: 'other-session' })]);
  expect((await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore)).every(row => !('key' in row))).toBe(true);
});

it('enforces both count and byte bounds before writing another ciphertext', async () => {
  const adapter = new IndexedDbWhiteboardOutbox(), first = update(1);
  await adapter.put(scope(), first);
  const stored = (await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore))[0]!;
  const entry = (stored.entries as Record<string, unknown>[])[0]!;
  await replaceActive({ ...stored, entries: Array.from({ length: WHITEBOARD_SYNC.pendingUpdates }, () => ({ ...entry })) });
  await expect(adapter.put(scope(), update(1))).rejects.toBeInstanceOf(WhiteboardOutboxLimitError);

  const byteScope = scope({ boardId: 'board-bytes' });
  await expect(adapter.put(byteScope, update(1, 'A'.repeat(WHITEBOARD_SYNC.pendingBytes + 1)))).rejects.toBeInstanceOf(WhiteboardOutboxLimitError);
  expect((await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore)).some(row => row.boardId === 'board-bytes')).toBe(false);
});
