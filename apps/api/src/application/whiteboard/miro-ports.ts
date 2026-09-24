import type { Principal } from '../../domain/principal';

export const WHITEBOARD_MIRO_IMPORT = Symbol('WhiteboardMiroImport');

export type MiroImportErrorCode =
  | 'NOT_CONNECTED' | 'OAUTH_STATE_INVALID' | 'OAUTH_SCOPE_INSUFFICIENT'
  | 'REMOTE_UNAUTHORIZED' | 'REMOTE_RATE_LIMITED' | 'REMOTE_TIMEOUT'
  | 'REMOTE_SCHEMA_CHANGED' | 'REMOTE_UNAVAILABLE' | 'ITEM_LIMIT_EXCEEDED'
  | 'REPEATED_CURSOR' | 'PAYLOAD_TOO_LARGE' | 'INVALID_REQUEST';

export class MiroImportError extends Error {
  constructor(readonly code: MiroImportErrorCode) { super(code); this.name = 'MiroImportError'; }
}

export interface MiroAuthorizationState {
  readonly returnTo: string;
}

export interface SealedMiroCredential {
  readonly sealed: string;
  readonly scopes: readonly string[];
  readonly connectedAt: string;
  readonly expiresAt: string | null;
  readonly revision: number;
}

export type MiroAuditAction = 'connected' | 'refreshed' | 'revoked' | 'import_fetched';

export interface MiroCredentialRepository {
  createState(principal: Principal, stateHash: string, returnTo: string, expiresAt: Date): Promise<void>;
  consumeState(principal: Principal, stateHash: string, now: Date): Promise<MiroAuthorizationState | null>;
  save(principal: Principal, value: Omit<SealedMiroCredential, 'revision'>): Promise<void>;
  load(principal: Principal): Promise<SealedMiroCredential | null>;
  rotate(principal: Principal, expectedRevision: number, value: Omit<SealedMiroCredential, 'revision' | 'connectedAt'>): Promise<boolean>;
  revoke(principal: Principal): Promise<SealedMiroCredential | null>;
  audit(principal: Principal, action: MiroAuditAction, sourceBoardId?: string, objectCount?: number): Promise<void>;
}

export interface MiroPlainCredential {
  readonly access: string;
  readonly refresh: string | null;
}

export interface MiroTokenResult {
  readonly credential: MiroPlainCredential;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
}
export class MiroRemoteUnauthorized extends Error { constructor() { super('MIRO_HTTP_401'); this.name='MiroRemoteUnauthorized'; } }
export interface MiroRemoteClient {
  authorizationUrl(state:string):string;
  exchange(code:string):Promise<MiroTokenResult>;
  refresh(refresh:string):Promise<MiroTokenResult>;
  revoke(access:string):Promise<void>;
  boards(access:string,offset:number,limit:number):Promise<{items:Array<{id:string;name:string;modifiedAt:string|null}>;hasMore:boolean}>;
  board(access:string,boardId:string):Promise<{id:string;name:string}>;
  items(access:string,boardId:string,cursor?:string):Promise<{data:Record<string,unknown>[];cursor?:string|null}>;
}

export interface MiroCredentialCipher {
  seal(principal: Principal, value: MiroPlainCredential): string;
  open(principal: Principal, value: string): MiroPlainCredential;
}
