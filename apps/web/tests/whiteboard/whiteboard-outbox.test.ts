import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { fingerprintWhiteboardSession, IndexedDbWhiteboardOutbox, markWhiteboardSessionRevoked, WHITEBOARD_OUTBOX_STORAGE, WHITEBOARD_REVOKED_SESSION_STORAGE_KEY, WhiteboardOutboxLimitError, type PendingWhiteboardUpdate, type WhiteboardOutboxScope } from '@/lib/whiteboard-outbox';

function update(epoch: number, value = 'AQID'): PendingWhiteboardUpdate {
  return { type: 'update', epoch, updateId: crypto.randomUUID(), update: value };
}

const scope = (overrides: Partial<WhiteboardOutboxScope> = {}): WhiteboardOutboxScope => ({
  boardId: 'board-1', principalId: 'user-1', sessionId: 'session-1', epoch: 1,
  accessReceiptId:'11111111-1111-4111-8111-111111111111', ...overrides,
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

beforeEach(() => { vi.restoreAllMocks();vi.stubGlobal('indexedDB', new IDBFactory()); });

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

it('summarizes durable updates across epochs and atomically discards only the matching quarantine receipt',async()=>{
  const adapter=new IndexedDbWhiteboardOutbox();await adapter.put(scope({epoch:1}),update(1));await adapter.put(scope({epoch:2}),update(2));
  await expect(adapter.summarize(scope())).resolves.toEqual({pendingCount:2,pendingBytes:8});
  const [receipt]=await adapter.quarantineExcept(scope(),null,'ACCESS_DENIED');expect(receipt).toBeDefined();
  await expect(adapter.discardQuarantine({principalId:'other'},receipt!.receiptId)).resolves.toBe(false);
  expect(await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore)).toHaveLength(2);
  await expect(adapter.discardQuarantine(scope(),receipt!.receiptId)).resolves.toBe(true);
  const remaining=await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore);expect(remaining).toHaveLength(1);expect(remaining[0]!.receiptId).not.toBe(receipt!.receiptId);
});

it('lists old-session receipts by authenticated principal without exposing ciphertext and permits principal-scoped discard',async()=>{
  const adapter=new IndexedDbWhiteboardOutbox();await adapter.put(scope({sessionId:'old-session'}),update(1));await adapter.quarantineSession({principalId:'user-1',sessionId:'old-session'},'ACCESS_DENIED');
  const receipts=await adapter.listQuarantine({principalId:'user-1'},'board-1');expect(receipts).toHaveLength(1);expect(receipts[0]).not.toHaveProperty('ciphertext');
  await expect(adapter.listQuarantine({principalId:'other'},'board-1')).resolves.toEqual([]);
  await expect(adapter.discardQuarantine({principalId:'user-1'},receipts[0]!.receiptId)).resolves.toBe(true);expect(await rows(WHITEBOARD_OUTBOX_STORAGE.quarantineStore)).toEqual([]);
});

it('keeps legacy quarantine data discard-only when it has no authenticated access receipt',async()=>{
  const adapter=new IndexedDbWhiteboardOutbox();await adapter.put(scope(),update(1));
  const stored=(await rows(WHITEBOARD_OUTBOX_STORAGE.activeStore))[0]!;
  const {accessReceiptId:_,...legacy}=stored;
  await replaceActive(legacy);
  const receipts=await adapter.quarantineExcept(scope(),null,'ACCESS_DENIED');
  expect(receipts).toHaveLength(1);expect(receipts[0]).not.toHaveProperty('accessReceiptId');
  await expect(adapter.discardQuarantine({principalId:'user-1'},receipts[0]!.receiptId)).resolves.toBe(true);
});

it('keeps a logout tombstone when IndexedDB fails, then purges only that session before any later load',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  const factory=new IDBFactory();vi.stubGlobal('indexedDB',factory);const adapter=new IndexedDbWhiteboardOutbox();const token='revoked-token',sessionId=await fingerprintWhiteboardSession(token);const revoked=scope({sessionId}),other=scope({sessionId:'other-session'});
  await adapter.put(revoked,update(1));await adapter.put(other,update(1));
  vi.stubGlobal('indexedDB',{open:()=>{throw new Error('simulated indexeddb outage');}});
  markWhiteboardSessionRevoked('user-1',token);await vi.waitFor(()=>expect(storage.get(WHITEBOARD_REVOKED_SESSION_STORAGE_KEY)).toContain(sessionId));
  await expect(new IndexedDbWhiteboardOutbox().load(revoked)).rejects.toThrow('simulated indexeddb outage');
  await expect(new IndexedDbWhiteboardOutbox().put(revoked,update(1))).rejects.toThrow('simulated indexeddb outage');
  vi.stubGlobal('indexedDB',factory);await expect(new IndexedDbWhiteboardOutbox().load(revoked)).resolves.toEqual([]);await expect(new IndexedDbWhiteboardOutbox().load(other)).resolves.toHaveLength(1);
  expect(storage.get(WHITEBOARD_REVOKED_SESSION_STORAGE_KEY)).toBe('[]');
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

it('fails closed when logout lands after an IndexedDB get starts but before its key row returns',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  const raceScope=scope({principalId:'idb-race-user',sessionId:'idb-race-session'}),pending=update(1);
  let releaseGet!:()=>void;let signalGet!:()=>void;const getStarted=new Promise<void>(resolve=>{signalGet=resolve;});
  const immediateRequest=(result:unknown)=>{const value:{result:unknown;error:null;onsuccess:null|(()=>void);onerror:null|(()=>void)}={result,error:null,onsuccess:null,onerror:null};queueMicrotask(()=>value.onsuccess?.());return value;};
  const delayedRequest={result:{...raceScope,id:JSON.stringify([raceScope.boardId,raceScope.principalId,raceScope.sessionId,raceScope.epoch]),key:{} as CryptoKey,entries:[{updateId:pending.updateId,iv:new ArrayBuffer(12),value:new ArrayBuffer(1),plainBytes:4}]},error:null,onsuccess:null as null|(()=>void),onerror:null as null|(()=>void)};
  releaseGet=()=>queueMicrotask(()=>delayedRequest.onsuccess?.());
  const transaction=(stores:string|string[])=>{let completion:null|(()=>void)=null;const tx={error:null,objectStore:(_name:string)=>({getAll:()=>immediateRequest([]),delete:()=>undefined,get:()=>{signalGet();return delayedRequest;}})} as unknown as IDBTransaction;Object.defineProperty(tx,'oncomplete',{set(value){completion=value as ()=>void;queueMicrotask(()=>completion?.());}});return tx;};
  const database={transaction,close:()=>undefined,createObjectStore:()=>undefined};
  const opened={result:database,error:null,onsuccess:null as null|(()=>void),onerror:null as null|(()=>void),onupgradeneeded:null as null|(()=>void)};
  vi.stubGlobal('indexedDB',{open:()=>{queueMicrotask(()=>opened.onsuccess?.());return opened;}});
  vi.spyOn(crypto.subtle,'digest').mockImplementation(()=>new Promise<ArrayBuffer>(()=>{}));
  const loading=new IndexedDbWhiteboardOutbox().load(raceScope);await getStarted;
  markWhiteboardSessionRevoked(raceScope.principalId,'idb-race-token');releaseGet();
  await expect(loading).rejects.toThrow('WHITEBOARD_SESSION_REVOKED');
});

it('writes a broad tombstone synchronously and blocks key reads when Web Crypto digest never settles',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  const adapter=new IndexedDbWhiteboardOutbox();await adapter.put(scope({principalId:'hung-crypto-user'}),update(1));
  vi.spyOn(crypto.subtle,'digest').mockImplementation(()=>new Promise<ArrayBuffer>(()=>{}));
  markWhiteboardSessionRevoked('hung-crypto-user','hung-crypto-token');
  expect(JSON.parse(storage.get(WHITEBOARD_REVOKED_SESSION_STORAGE_KEY)??'[]')).toContainEqual(expect.objectContaining({principalId:'hung-crypto-user',sessionId:null,attemptId:expect.any(String)}));
  await expect(adapter.load(scope({principalId:'hung-crypto-user'}))).rejects.toThrow('WHITEBOARD_SESSION_REVOKED');
});

it('keeps another logout attempt broad when one token fingerprint completes first',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  const originalDigest=crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle,'digest').mockImplementation((algorithm,data)=>new TextDecoder().decode(data as ArrayBuffer)==='hung-token'
    ? new Promise<ArrayBuffer>(()=>{})
    : originalDigest(algorithm,data));
  markWhiteboardSessionRevoked('dual-logout-user','fast-token');
  markWhiteboardSessionRevoked('dual-logout-user','hung-token');
  await vi.waitFor(()=>{
    const values=JSON.parse(storage.get(WHITEBOARD_REVOKED_SESSION_STORAGE_KEY)??'[]') as Array<{principalId:string;sessionId:string|null;attemptId?:string}>;
    expect(values.filter(value=>value.principalId==='dual-logout-user'&&value.sessionId===null)).toHaveLength(1);
    expect(values.filter(value=>value.principalId==='dual-logout-user'&&typeof value.sessionId==='string')).toHaveLength(1);
  });
  await expect(new IndexedDbWhiteboardOutbox().load(scope({principalId:'dual-logout-user'}))).rejects.toThrow('WHITEBOARD_SESSION_REVOKED');
});

// Keep last: the intentionally never-settling cleanup must remain fail-closed and therefore
// also keeps the in-realm fallback lock closed for the rest of this process.
it('returns from logout after writing the tombstone even when IndexedDB open never settles',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  vi.stubGlobal('indexedDB',{open:()=>({})});
  const token='hung-indexeddb-token',sessionId=await fingerprintWhiteboardSession(token);
  markWhiteboardSessionRevoked('user-1',token);
  await vi.waitFor(()=>expect(storage.get(WHITEBOARD_REVOKED_SESSION_STORAGE_KEY)).toContain(sessionId));
});
