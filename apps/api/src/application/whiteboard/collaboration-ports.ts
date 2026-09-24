import type { whiteboard as C } from '@repo/contracts';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { TenantSession } from '../ports/database.port';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_UPDATE_VALIDATOR = Symbol('WhiteboardUpdateValidator');
export const WHITEBOARD_COLLABORATION_STORE = Symbol('WhiteboardCollaborationStore');
export type CollaborationErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'ARCHIVED' | 'WORKSHOP_FROZEN' | 'STALE_EPOCH' | 'IDEMPOTENCY_CONFLICT' | 'RATE_LIMITED' | 'VALIDATION_FAILED' | 'VALIDATOR_UNAVAILABLE';
export class WhiteboardCollaborationError extends Error {
  constructor(readonly code: CollaborationErrorCode) { super(code); this.name = 'WhiteboardCollaborationError'; }
}
export interface WhiteboardSyncState { epoch: number; seq: number; update: Uint8Array; role: C.Board['role']; archived: boolean; }
export type WhiteboardSyncHead = Omit<WhiteboardSyncState, 'update'>;
export interface WhiteboardUpdateAck { epoch: number; seq: number; updateId: string; replayed: boolean; update: Uint8Array; }
/** Never broadcast or acknowledge before the owning outer transaction commits. */
export interface WhiteboardPendingUpdate extends WhiteboardUpdateAck { durability: 'pending'; }
export interface WhiteboardUpdateInput { epoch: number; updateId: string; update: Uint8Array; }
export interface WhiteboardCommandsInput { epoch: number; requestId: string; commands: WhiteboardCommand[]; }
export interface WhiteboardCollaborationStore {
  head(principal: Principal, boardId: string): Promise<WhiteboardSyncHead>;
  load(principal: Principal, boardId: string, stateVector?: Uint8Array): Promise<WhiteboardSyncState>;
  append(principal: Principal, boardId: string, input: WhiteboardUpdateInput): Promise<WhiteboardUpdateAck>;
  writeCommandsInTransaction(session: TenantSession, principal: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardPendingUpdate>;
  writeCommands(principal: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardUpdateAck>;
}
export interface ValidatedWhiteboardUpdate { snapshot: Uint8Array; update: Uint8Array; }
/** Untrusted decoding/validation must be isolated from the API event loop. */
export interface WhiteboardUpdateValidator {
  objects(snapshot: Uint8Array): Promise<WhiteboardObject[]>;
  objectIds(snapshot: Uint8Array): Promise<string[]>;
  validate(snapshot: Uint8Array, update: Uint8Array): Promise<ValidatedWhiteboardUpdate>;
  commands(snapshot: Uint8Array, commands: WhiteboardCommand[]): Promise<ValidatedWhiteboardUpdate>;
  diff(snapshot: Uint8Array, stateVector?: Uint8Array): Promise<Uint8Array>;
}
