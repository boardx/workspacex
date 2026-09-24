import {describe,expect,it} from 'vitest';
import * as C from '../src/whiteboard';

describe('whiteboard quarantine recovery contract',()=>{
  const input={requestId:'11111111-1111-4111-8111-111111111111',receiptId:'22222222-2222-4222-8222-222222222222',sessionFingerprint:'a'.repeat(64),epoch:1,pendingCount:100,pendingBytes:4096,reason:'ACCESS_DENIED' as const};
  it('accepts receipt metadata without accepting ciphertext or encryption keys',()=>{expect(C.RequestQuarantineRecovery.parse(input)).toEqual(input);expect(C.RequestQuarantineRecovery.safeParse({...input,ciphertext:'secret'}).success).toBe(false);expect(C.RequestQuarantineRecovery.safeParse({...input,key:'secret'}).success).toBe(false);});
  it('bounds the request and exposes the authenticated route',()=>{expect(C.RequestQuarantineRecovery.safeParse({...input,pendingCount:201}).success).toBe(false);expect(C.operations.requestQuarantineRecovery).toMatchObject({method:'POST',path:'/whiteboards/:boardId/quarantine-recovery-requests'});});
});
