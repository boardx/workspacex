import {ConflictException,ForbiddenException} from '@nestjs/common';
import {describe,expect,it,vi} from 'vitest';
import {WhiteboardRecoveryError,type WhiteboardRepository} from '../../src/application/whiteboard/ports';
import {toOrgId} from '../../src/domain/org-id';
import {WhiteboardController} from '../../src/interface/controllers/whiteboard.controller';

const principal={orgId:toOrgId('recovery-org'),userId:'member'};
const boardId='11111111-1111-4111-8111-111111111111';
const input={requestId:'22222222-2222-4222-8222-222222222222',receiptId:'33333333-3333-4333-8333-333333333333',accessReceiptId:'44444444-4444-4444-8444-444444444444',sessionFingerprint:'a'.repeat(64),epoch:1,pendingCount:3,pendingBytes:12,reason:'ACCESS_DENIED' as const};
function controller(requestQuarantineRecovery:WhiteboardRepository['requestQuarantineRecovery']){return new WhiteboardController({requestQuarantineRecovery} as unknown as WhiteboardRepository,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never);}

describe('whiteboard quarantine recovery controller',()=>{
  it('uses only the authenticated principal and returns the auditable repository receipt',async()=>{const request=vi.fn<WhiteboardRepository['requestQuarantineRecovery']>().mockResolvedValue({requestId:input.requestId,status:'pending-review',createdAt:'2026-09-24T00:00:00.000Z'});await expect(controller(request).requestQuarantineRecovery(principal,boardId,input)).resolves.toMatchObject({status:'pending-review'});expect(request).toHaveBeenCalledWith(principal,boardId,input);});
  it('returns a stable refusal when organization policy does not allow a request',async()=>{const request=vi.fn<WhiteboardRepository['requestQuarantineRecovery']>().mockResolvedValue(null);await expect(controller(request).requestQuarantineRecovery(principal,boardId,input)).rejects.toBeInstanceOf(ForbiddenException);});
  it('returns a stable conflict for changed-argument replay',async()=>{const request=vi.fn<WhiteboardRepository['requestQuarantineRecovery']>().mockRejectedValue(new WhiteboardRecoveryError('IDEMPOTENCY_CONFLICT'));await expect(controller(request).requestQuarantineRecovery(principal,boardId,input)).rejects.toBeInstanceOf(ConflictException);});
});
