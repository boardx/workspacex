import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {wrapWhiteboardKey,unwrapWhiteboardKey,rewrapWhiteboardKey} from '@/lib/whiteboard-outbox-key-envelope';
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
afterEach(()=>vi.unstubAllGlobals());
const context={boardId:'board-a',keyId:'key-a',generation:'a'.repeat(64)};
it('stores only an authenticated envelope and unwraps a nonextractable working key',async()=>{
 const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const envelope=await wrapWhiteboardKey(generated,'high-entropy-test-token',context);
 expect(Object.keys(envelope).sort()).toEqual(['boardId','ciphertext','generation','iv','keyId','salt','version']);
 expect(envelope.ciphertext.byteLength).toBe(48);
 const key=await unwrapWhiteboardKey(envelope,'high-entropy-test-token',context);
 expect(key.extractable).toBe(false);await expect(crypto.subtle.exportKey('raw',key)).rejects.toThrow();
 const wrapping=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['wrapKey']);
 await expect(crypto.subtle.wrapKey('raw',key,wrapping,{name:'AES-GCM',iv:crypto.getRandomValues(new Uint8Array(12))})).rejects.toThrow();
 const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode('queued operation');
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},generated,plain);
 expect(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,encrypted))).toEqual(plain);
});
it('binds token, board, key identity, generation and authenticated ciphertext',async()=>{
 const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const envelope=await wrapWhiteboardKey(generated,'source-token',context);
 await expect(unwrapWhiteboardKey(envelope,'different-token',context)).rejects.toThrow();
 for(const patch of [{boardId:'board-b'},{keyId:'key-b'},{generation:'b'.repeat(64)}]){
  await expect(Promise.resolve().then(()=>unwrapWhiteboardKey({...envelope,...patch},'source-token',context))).rejects.toThrow();
 }
 const changed=envelope.ciphertext.slice(0),altered=new Uint8Array(changed);altered[0]=altered[0]!^1;
 await expect(unwrapWhiteboardKey({...envelope,ciphertext:changed},'source-token',context)).rejects.toThrow();
 for(const field of ['salt','iv'] as const){
  const mutated=envelope[field].slice(0),view=new Uint8Array(mutated);view[0]=view[0]!^1;
  await expect(unwrapWhiteboardKey({...envelope,[field]:mutated},'source-token',context)).rejects.toThrow();
 }
 await expect(unwrapWhiteboardKey({...envelope,version:2} as unknown as typeof envelope,'source-token',context)).rejects.toThrow('OUTBOX_KEY_ENVELOPE_INVALID');
 await expect(unwrapWhiteboardKey({...envelope,iv:new ArrayBuffer(11)},'source-token',context)).rejects.toThrow('OUTBOX_KEY_ENVELOPE_INVALID');
});
it('rebind wraps the same data key for the successor without returning an extractable handle',async()=>{
 const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const original=await wrapWhiteboardKey(generated,'source-token',context);
 const successor=await rewrapWhiteboardKey(original,'source-token','target-token','b'.repeat(64),context);
 expect(successor.keyId).toBe(original.keyId);
 const key=await unwrapWhiteboardKey(successor,'target-token',{...context,generation:'b'.repeat(64)});expect(key.extractable).toBe(false);
 await expect(crypto.subtle.exportKey('raw',key)).rejects.toThrow();
 await expect(unwrapWhiteboardKey(successor,'source-token',{...context,generation:'b'.repeat(64)})).rejects.toThrow();
 const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode('prior-generation pending operation');
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},generated,plain);
 expect(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,encrypted))).toEqual(plain);
});
