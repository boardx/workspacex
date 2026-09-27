import type { whiteboard as C } from '@repo/contracts';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { TenantSession } from '../ports/database.port';
import type { Principal } from '../../domain/principal';
import type { WhiteboardCommentCommand, WhiteboardCommentThread, WhiteboardCollaborationEvent } from '@repo/contracts/whiteboard-collaboration';
export const WHITEBOARD_UPDATE_VALIDATOR = Symbol('WhiteboardUpdateValidator');
export const WHITEBOARD_COLLABORATION_STORE = Symbol('WhiteboardCollaborationStore');
export const WHITEBOARD_COMMENT_STORE = Symbol('WhiteboardCommentStore');
export const WHITEBOARD_RECOVERY_SERVICE = Symbol('WhiteboardRecoveryService');
export type CollaborationErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'ARCHIVED' | 'STALE_EPOCH' | 'IDEMPOTENCY_CONFLICT' | 'COMMENT_CONFLICT' | 'INVALID_MENTION' | 'RATE_LIMITED' | 'VALIDATION_FAILED' | 'VALIDATOR_UNAVAILABLE' | 'DEPENDENCY_UNAVAILABLE' | 'INTEGRITY_FAILED';
export class WhiteboardCollaborationError extends Error {
  constructor(readonly code: CollaborationErrorCode) { super(code); this.name = 'WhiteboardCollaborationError'; }
}
export interface WhiteboardSyncState { epoch: number; seq: number; update: Uint8Array; role: C.Board['role']; archived: boolean; }
export type WhiteboardSyncHead = Omit<WhiteboardSyncState, 'update'>;
export interface WhiteboardUpdateAck { epoch: number; seq: number; updateId: string; gestureId: string; replayed: boolean; update: Uint8Array; }
/** Never broadcast or acknowledge before the owning outer transaction commits. */
export interface WhiteboardPendingUpdate extends WhiteboardUpdateAck { durability: 'pending'; }
export interface WhiteboardUpdateInput { epoch: number; updateId: string; gestureId: string; update: Uint8Array; }
export interface WhiteboardCommandsInput { epoch: number; requestId: string; commands: WhiteboardCommand[]; actorId?: string; }
export interface WhiteboardCollaborationStore {
  compensateInTransaction?(session:TenantSession,principal:Principal,boardId:string,input:{epoch:number;requestId:string;actorId:string;before:Uint8Array}):Promise<WhiteboardPendingUpdate>;
  head(principal: Principal, boardId: string): Promise<WhiteboardSyncHead>;
  load(principal: Principal, boardId: string, stateVector?: Uint8Array): Promise<WhiteboardSyncState>;
  loadInTransaction(session:TenantSession,principal:Principal,boardId:string,stateVector?:Uint8Array):Promise<WhiteboardSyncState>;
  append(principal: Principal, boardId: string, input: WhiteboardUpdateInput): Promise<WhiteboardUpdateAck>;
  writeCommandsInTransaction(session: TenantSession, principal: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardPendingUpdate>;
  writeCommands(principal: Principal, boardId: string, input: WhiteboardCommandsInput): Promise<WhiteboardUpdateAck>;
}
export interface WhiteboardCommentStore {
  list(principal: Principal, boardId: string): Promise<WhiteboardCommentThread[]>;
  dispatch(principal: Principal, boardId: string, command: WhiteboardCommentCommand): Promise<{ operationId: string; replayed: boolean; threads: WhiteboardCommentThread[]; events: WhiteboardCollaborationEvent[] }>;
}
export interface WhiteboardPresenceIdentity { displayName:string; avatarUrl:string|null; principalKind:'user'|'agent'; }
export interface WhiteboardPresenceIdentityResolver { resolve(principal:Principal):Promise<WhiteboardPresenceIdentity>; }
export interface ValidatedWhiteboardUpdate { snapshot: Uint8Array; update: Uint8Array; }
/** Untrusted decoding/validation must be isolated from the API event loop. */
export interface WhiteboardUpdateValidator {
  compensate?(snapshot:Uint8Array,before:Uint8Array):Promise<ValidatedWhiteboardUpdate>;
  objects(snapshot: Uint8Array): Promise<WhiteboardObject[]>;
  objectIds(snapshot: Uint8Array): Promise<string[]>;
  validate(snapshot: Uint8Array, update: Uint8Array): Promise<ValidatedWhiteboardUpdate>;
  commands(snapshot: Uint8Array, commands: WhiteboardCommand[]): Promise<ValidatedWhiteboardUpdate>;
  diff(snapshot: Uint8Array, stateVector?: Uint8Array): Promise<Uint8Array>;
}
