import type { Principal } from "../../domain/principal";
export const WHITEBOARD_MURAL_IMPORT = Symbol("WhiteboardMuralImport");
export type MuralImportErrorCode =
  | "NOT_CONNECTED"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_SCOPE_INSUFFICIENT"
  | "REMOTE_UNAUTHORIZED"
  | "REMOTE_RATE_LIMITED"
  | "REMOTE_TIMEOUT"
  | "REMOTE_SCHEMA_CHANGED"
  | "REMOTE_UNAVAILABLE"
  | "WIDGET_LIMIT_EXCEEDED"
  | "REPEATED_CURSOR"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_REQUEST";
export class MuralImportError extends Error {
  constructor(readonly code: MuralImportErrorCode) {
    super(code);
    this.name = "MuralImportError";
  }
}
export interface MuralAuthorizationState {
  readonly returnTo: string;
}
export interface SealedMuralCredential {
  readonly sealed: string;
  readonly scopes: readonly string[];
  readonly connectedAt: string;
  readonly expiresAt: string | null;
  readonly revision: number;
}
export type MuralAuditAction =
  | "connected"
  | "refreshed"
  | "revoked"
  | "import_fetched";
export interface MuralCredentialRepository {
  createState(
    p: Principal,
    stateHash: string,
    returnTo: string,
    expiresAt: Date,
  ): Promise<void>;
  consumeState(
    p: Principal,
    stateHash: string,
    now: Date,
  ): Promise<MuralAuthorizationState | null>;
  save(
    p: Principal,
    value: Omit<SealedMuralCredential, "revision">,
  ): Promise<void>;
  load(p: Principal): Promise<SealedMuralCredential | null>;
  rotate(
    p: Principal,
    expectedRevision: number,
    value: Omit<SealedMuralCredential, "revision" | "connectedAt">,
  ): Promise<boolean>;
  revoke(p: Principal): Promise<SealedMuralCredential | null>;
  audit(
    p: Principal,
    action: MuralAuditAction,
    sourceMuralId?: string,
    objectCount?: number,
  ): Promise<void>;
}
export interface MuralPlainCredential {
  readonly access: string;
  readonly refresh: string | null;
}
export interface MuralTokenResult {
  readonly credential: MuralPlainCredential;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
}
export class MuralRemoteUnauthorized extends Error {
  constructor() {
    super("MURAL_HTTP_401");
    this.name = "MuralRemoteUnauthorized";
  }
}
export interface MuralRemoteClient {
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<MuralTokenResult>;
  refresh(refresh: string): Promise<MuralTokenResult>;
  revoke(access: string): Promise<void>;
  workspaces(
    access: string,
    next: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<{ id: string; name: string }>;
    next: string | null;
  }>;
  murals(
    access: string,
    workspaceId: string,
    next: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<{ id: string; name: string; modifiedAt: string | null }>;
    next: string | null;
  }>;
  mural(access: string, muralId: string): Promise<{ id: string; name: string }>;
  widgets(
    access: string,
    muralId: string,
    next?: string,
  ): Promise<{ data: Record<string, unknown>[]; next: string | null }>;
}
export interface MuralCredentialCipher {
  seal(p: Principal, value: MuralPlainCredential): string;
  open(p: Principal, value: string): MuralPlainCredential;
}
