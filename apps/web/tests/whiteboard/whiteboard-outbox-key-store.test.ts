import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {IndexedDbEncryptedWhiteboardOutbox} from '@/lib/whiteboard-outbox';
import type {WhiteboardKeyMode} from '@/lib/whiteboard-outbox-key-store';
const update=(id=crypto.randomUUID())=>({type:'update' as const,epoch:1,updateId:id,gestureId:crypto.randomUUID(),update:'AAA='});
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function rejectNative(name='DataCloneError'){
 const put=IDBObjectStore.prototype.put;
 vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){if(key==='aes-key')throw new DOMException('native key storage failed',name);return put.call(this,value,key);});
}
async function database(){return await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('workspacex-whiteboard-outbox-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function read<T>(db:IDBDatabase,store:string,key?:IDBValidKey):Promise<T>{return await new Promise((resolve,reject)=>{const q=key===undefined?db.transaction(store).objectStore(store).getAll():db.transaction(store).objectStore(store).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function write(db:IDBDatabase,store:string,key:IDBValidKey,value?:unknown){await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);if(value===undefined)tx.objectStore(store).delete(key);else tx.objectStore(store).put(value,key);});}
it('fresh DataCloneError uses encrypted envelopes and preserves ciphertext through reopen and rebind',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board');const intent=update();await first.persist('old-token',intent);first.close();
 const db=await database(),mode=await read<WhiteboardKeyMode>(db,'meta','key-envelope:board');
 expect(mode.boardId).toBe('board');expect(Object.values(mode.envelopes)).toHaveLength(1);
 expect(await read(db,'meta','aes-key')).toBeUndefined();
 const rows=await read<{ciphertext:ArrayBuffer}[]>(db,'updates');expect(rows).toHaveLength(1);expect(rows[0]!.ciphertext).toBeInstanceOf(ArrayBuffer);
 expect(JSON.stringify(mode)).not.toContain('old-token');expect(JSON.stringify(rows)).not.toContain(intent.update);
 const second=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await second.restore('old-token')).toEqual({revoked:false,updates:[intent]});
 await second.rebind('old-token','new-token');second.close();const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');
 expect(await fresh.restore('new-token')).toEqual({revoked:false,updates:[intent]});expect((await fresh.restore('old-token')).revoked).toBe(true);fresh.close();db.close();
});
it('same-generation first-key race chooses one committed key and keeps both writes readable',async()=>{
 rejectNative();const a=new IndexedDbEncryptedWhiteboardOutbox('board'),b=new IndexedDbEncryptedWhiteboardOutbox('board'),first=update(),second=update();
 await Promise.all([a.persist('token',first),b.persist('token',second)]);
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect((await fresh.restore('token')).updates).toEqual(expect.arrayContaining([first,second]));
 const db=await database(),mode=await read<WhiteboardKeyMode>(db,'meta','key-envelope:board');expect(Object.values(mode.envelopes)).toHaveLength(1);expect(mode.revision).toBe(1);db.close();a.close();b.close();fresh.close();
});
it('prepared journal is recoverable by only the new token after a crypto failure',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board'),intent=update();await first.persist('old',intent);
 vi.spyOn(crypto.subtle,'encrypt').mockRejectedValueOnce(new Error('simulated crash after prepare'));
 await expect(first.rebind('old','new')).rejects.toThrow('simulated crash');first.close();
 const db=await database(),journal=await read<{keyId:string;fromHash:string;toHash:string}>(db,'rebinds','board'),mode=await read<WhiteboardKeyMode>(db,'meta','key-envelope:board');
 expect(mode.envelopes[journal.fromHash]!.keyId).toBe(journal.keyId);expect(mode.envelopes[journal.toHash]!.keyId).toBe(journal.keyId);db.close();
 const old=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await old.restore('old')).toEqual({revoked:true,updates:[]});
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await fresh.restore('new')).toEqual({revoked:false,updates:[intent]});old.close();fresh.close();
});
it('independent login generation cannot overwrite an existing target key or its rows',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board'),a=update(),b=update();await first.persist('old',a);await first.persist('new',b);
 await expect(first.rebind('old','new')).rejects.toThrow('OUTBOX_KEY_TARGET_CONFLICT');
 expect((await first.restore('old')).updates).toEqual([a]);expect((await first.restore('new')).updates).toEqual([b]);first.close();
});
it('revocation fences late writes and authorized reauthorization preserves the old tombstone without rows',async()=>{
 rejectNative();const old=new IndexedDbEncryptedWhiteboardOutbox('board'),other=new IndexedDbEncryptedWhiteboardOutbox('board');await old.persist('token',update());await other.revoke('token');
 await expect(old.persist('token',update())).rejects.toThrow('OUTBOX_REVOKED');
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await fresh.restore('token')).toEqual({revoked:true,updates:[]});await fresh.reauthorize('token');
 const accepted=update();await fresh.persist('token',accepted);await old.revoke('token');const reload=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await reload.restore('token')).toEqual({revoked:false,updates:[accepted]});
 await expect(old.persist('token',update())).rejects.toThrow('OUTBOX_REVOKED');old.close();other.close();fresh.close();reload.close();
});
it.each(['QuotaExceededError','AbortError'])('%s does not select compatibility mode',async name=>{
 rejectNative(name);const box=new IndexedDbEncryptedWhiteboardOutbox('board');await expect(box.restore('token')).rejects.toMatchObject({name});
 const db=await database();expect(await read(db,'meta','key-envelope:board')).toBeUndefined();db.close();box.close();
});
it('missing envelope for durable rows and malformed mode never regenerate a key',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board');await first.persist('token',update());first.close();const db=await database();await write(db,'meta','key-envelope:board');
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');await expect(fresh.restore('token')).rejects.toThrow('OUTBOX_KEY_MISSING');
 await write(db,'meta','key-envelope:board',{version:999,boardId:'board',revision:1,envelopes:{}});await expect(fresh.restore('token')).rejects.toThrow('OUTBOX_KEY_MODE_INVALID');fresh.close();db.close();
});
it('prepare refuses a stale mode revision after another tab initializes an independent generation',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board'),other=new IndexedDbEncryptedWhiteboardOutbox('board'),old=update(),unrelated=update();await first.persist('old',old);
 let start!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const wrap=crypto.subtle.wrapKey.bind(crypto.subtle);vi.spyOn(crypto.subtle,'wrapKey').mockImplementationOnce(async(...args)=>{start();await gate;return wrap(...args);});
 const pending=first.rebind('old','new'),failure=expect(pending).rejects.toThrow('OUTBOX_KEY_GENERATION_CHANGED');await started;await other.persist('unrelated',unrelated);release();await failure;
 expect((await first.restore('old')).updates).toEqual([old]);expect((await other.restore('unrelated')).updates).toEqual([unrelated]);
 const db=await database();expect(await read(db,'rebinds','board')).toBeUndefined();db.close();first.close();other.close();
});
it('matching prepared journal retry keeps old-generation writes fenced',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board'),intent=update();await first.persist('old',intent);
 vi.spyOn(crypto.subtle,'encrypt').mockRejectedValueOnce(new Error('interrupted finish'));await expect(first.rebind('old','new')).rejects.toThrow('interrupted finish');
 await expect(first.persist('old',update())).rejects.toThrow('OUTBOX_REVOKED');await first.rebind('old','new');
 expect(await first.restore('old')).toEqual({revoked:true,updates:[]});expect(await first.restore('new')).toEqual({revoked:false,updates:[intent]});first.close();
});
it('wrapped board remains readable when another board creates a native origin key',async()=>{
 rejectNative();const wrapped=new IndexedDbEncryptedWhiteboardOutbox('wrapped'),intent=update();await wrapped.persist('token',intent);
 vi.restoreAllMocks();const native=new IndexedDbEncryptedWhiteboardOutbox('native'),second=update();await native.persist('token',second);
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('wrapped');expect((await fresh.restore('token')).updates).toEqual([intent]);expect((await native.restore('token')).updates).toEqual([second]);
 const db=await database();expect(await read(db,'meta','aes-key')).toBeTruthy();expect(await read(db,'meta','key-envelope:wrapped')).toBeTruthy();expect(await read(db,'meta','key-envelope:native')).toBeUndefined();db.close();wrapped.close();native.close();fresh.close();
});
it('fresh key metadata contains no rows and an exhausted revision never overwrites the mode',async()=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await first.restore('old')).toEqual({revoked:false,updates:[]});
 const db=await database();expect(await read(db,'updates')).toEqual([]);const mode=await read<WhiteboardKeyMode>(db,'meta','key-envelope:board');await write(db,'meta','key-envelope:board',{...mode,revision:Number.MAX_SAFE_INTEGER});
 await expect(first.restore('new')).rejects.toThrow('OUTBOX_KEY_REVISION_LIMIT');expect((await read<WhiteboardKeyMode>(db,'meta','key-envelope:board')).revision).toBe(Number.MAX_SAFE_INTEGER);db.close();first.close();
});
it.each(['old','new'])('revoke %s during prepared-journal row crypto cannot resurrect ciphertext',async revoked=>{
 rejectNative();const first=new IndexedDbEncryptedWhiteboardOutbox('board'),other=new IndexedDbEncryptedWhiteboardOutbox('board');await first.persist('old',update());
 let start!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{start();await gate;return encrypt(...args);});
 const pending=first.rebind('old','new'),failure=expect(pending).rejects.toThrow('OUTBOX_REVOKED');await started;await other.revoke(revoked);release();await failure;
 const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect((await fresh.restore('new')).updates).toEqual([]);if(revoked==='new')expect((await fresh.restore('new')).revoked).toBe(true);first.close();other.close();fresh.close();
});
