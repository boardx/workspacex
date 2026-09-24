import type { z } from 'zod';
import type { whiteboard as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { OrgId } from '../../domain/org-id';
import type { TenantSession } from '../ports/database.port';
export const WHITEBOARD_REPOSITORY = Symbol('WhiteboardRepository');
export const WHITEBOARD_RECEIPT_MAINTENANCE = Symbol('WhiteboardReceiptMaintenance');
export type CreateBoard = z.infer<typeof C.CreateBoard>;
export type UpdateBoard = z.infer<typeof C.UpdateBoard>;
export type Member = z.infer<typeof C.Member>;
export type WhiteboardRecoveryErrorCode = 'IDEMPOTENCY_CONFLICT';
export class WhiteboardRecoveryError extends Error {
  constructor(readonly code: WhiteboardRecoveryErrorCode) { super(code); this.name = 'WhiteboardRecoveryError'; }
}
export interface WhiteboardReceiptMaintenance {
  ensureScheduled(session: TenantSession, orgId: OrgId): Promise<void>;
}
export interface WhiteboardRepository {
  list(principal: Principal): Promise<C.Board[]>;
  create(principal: Principal, input: CreateBoard): Promise<C.Board>;
  get(principal: Principal, boardId: string): Promise<C.Board | null>;
  update(principal: Principal, boardId: string, input: UpdateBoard): Promise<C.Board | null>;
  members(principal: Principal, boardId: string): Promise<Member[] | null>;
  putMember(principal: Principal, boardId: string, member: Member): Promise<boolean>;
  removeMember(principal: Principal, boardId: string, userId: string): Promise<boolean>;
  cleanupQuarantineAccessReceipts(principal: Principal): Promise<number>;
  issueQuarantineAccessReceipt(principal: Principal, boardId: string, sessionFingerprint: string, epoch: number): Promise<string>;
  requestQuarantineRecovery(principal: Principal, boardId: string, input: C.RequestQuarantineRecovery): Promise<C.QuarantineRecoveryRequest | null>;
}
