import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {IndexedDbEncryptedWhiteboardOutbox} from '@/lib/whiteboard-outbox';
const update=()=>({type:'update' as const,epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:'AAA='});
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('real IndexedDB transactions across independent outbox instances',()=>{
 it.each(['old','new'])('rebind cannot resurrect rows after %s generation revoked during crypto',async(revoked)=>{
  const first=new IndexedDbEncryptedWhiteboardOutbox('board'),other=new IndexedDbEncryptedWhiteboardOutbox('board');await first.persist('old',update());
  let release!:()=>void,start!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{start=resolve;});
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{start();await gate;return encrypt(...args);});
  const migrating=first.rebind('old','new');const result=expect(migrating).rejects.toThrow('OUTBOX_REVOKED');await started;await other.revoke(revoked);release();await result;
  const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect((await fresh.restore('new')).updates).toEqual([]);if(revoked==='new')expect((await fresh.restore('new')).revoked).toBe(true);first.close();other.close();fresh.close();
 });
 it('CAS permits one fresh tab, fences old persist/rebind, and late revoke preserves fresh rows',async()=>{
  const old=new IndexedDbEncryptedWhiteboardOutbox('board');await old.persist('token',update());await old.revoke('token');
  const a=new IndexedDbEncryptedWhiteboardOutbox('board'),b=new IndexedDbEncryptedWhiteboardOutbox('board');expect((await a.restore('token')).revoked).toBe(true);expect((await b.restore('token')).revoked).toBe(true);
  const results=await Promise.allSettled([a.reauthorize('token'),b.reauthorize('token')]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  const winner=results[0]!.status==='fulfilled'?a:b,accepted=update();await winner.persist('token',accepted);
  await expect(old.persist('token',update())).rejects.toThrow('OUTBOX_REVOKED');await expect(old.rebind('token','other-token')).rejects.toThrow('OUTBOX_REVOKED');await old.revoke('token');
  const fresh=new IndexedDbEncryptedWhiteboardOutbox('board');expect(await fresh.restore('token')).toEqual({revoked:false,updates:[accepted]});old.close();a.close();b.close();fresh.close();
 });
});

it('encrypts a typed restoration through close/reopen and token rebind, with the same immutable receipt identity',async()=>{
 const first=new IndexedDbEncryptedWhiteboardOutbox('restore-board'),intent={type:'restore-deletion' as const,epoch:1,updateId:crypto.randomUUID(),gestureId:'undo',deleteGestureId:'delete',objectIds:['note','edge']};
 await first.persist('old',intent);first.close();const second=new IndexedDbEncryptedWhiteboardOutbox('restore-board');
 expect(await second.restore('old')).toEqual({revoked:false,updates:[intent]});await second.rebind('old','new');
 const third=new IndexedDbEncryptedWhiteboardOutbox('restore-board');expect(await third.restore('new')).toEqual({revoked:false,updates:[intent]});expect((await third.restore('old')).revoked).toBe(true);
 await third.acknowledge('new',intent.updateId);expect((await third.restore('new')).updates).toEqual([]);second.close();third.close();
});

it('same-millisecond delete, restore and later edit preserve FIFO through reopen and rebind',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(123456);
 const first=new IndexedDbEncryptedWhiteboardOutbox('fifo-board');
 const deleted={...update(),updateId:'ffffffff-ffff-4fff-8fff-ffffffffffff',gestureId:'delete'};
 const restore={type:'restore-deletion' as const,epoch:1,updateId:'00000000-0000-4000-8000-000000000001',gestureId:'undo',deleteGestureId:'delete',objectIds:['note']};
 const later={...update(),updateId:'00000000-0000-4000-8000-000000000000'};
 await first.persist('old',deleted);await first.persist('old',restore);await first.persist('old',later);await first.persist('old',deleted);first.close();
 const second=new IndexedDbEncryptedWhiteboardOutbox('fifo-board');expect((await second.restore('old')).updates).toEqual([deleted,restore,later]);await second.rebind('old','new');expect((await second.restore('new')).updates).toEqual([deleted,restore,later]);second.close();
});
