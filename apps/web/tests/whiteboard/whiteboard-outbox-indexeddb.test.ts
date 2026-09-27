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
