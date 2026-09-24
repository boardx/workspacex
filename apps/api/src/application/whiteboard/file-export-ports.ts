import type { whiteboard as W, whiteboardFileExport as C } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';

export const WHITEBOARD_FILE_EXPORT_SOURCE = Symbol('WhiteboardFileExportSource');
export const WHITEBOARD_FILE_EXPORT_SERVICE = Symbol('WhiteboardFileExportService');
export const WHITEBOARD_FILE_EXPORT_REPOSITORY = Symbol('WhiteboardFileExportRepository');
export const WHITEBOARD_FILE_RENDERER = Symbol('WhiteboardFileRenderer');
export const WHITEBOARD_FILE_EXPORT_CLEANER = Symbol('WhiteboardFileExportCleaner');

export type WhiteboardFileExportErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'BOUNDS_EXCEEDED' | 'NOT_READY';
export class WhiteboardFileExportError extends Error {
  constructor(readonly code: WhiteboardFileExportErrorCode) { super(code); this.name = 'WhiteboardFileExportError'; }
}

export interface WhiteboardFileExportSnapshot {
  readonly boardName: string;
  readonly role: W.Board['role'];
  readonly objects: readonly WhiteboardObject[];
  readonly losses?: readonly C.BoardFileExportLoss[];
}

export interface WhiteboardFileExportSource {
  load(principal: Principal, boardId: string): Promise<WhiteboardFileExportSnapshot>;
}

export interface WhiteboardFileExportContent {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
}

export interface WhiteboardFileExportRecord {
  readonly status: C.BoardFileExportStatus;
  readonly objectKey: string | null;
  readonly sha256: string | null;
}
export interface WhiteboardFileExportClaim {
  readonly principal: Principal;
  readonly input: C.BoardFileExportInput;
  readonly status: C.BoardFileExportStatus;
  readonly objectKey: string;
  readonly leaseOwner: string;
}
export interface WhiteboardFileExportCleanup { readonly jobId: string; readonly objectKey: string; readonly cleanupOwner: string }
export interface WhiteboardFileExportRepository {
  create(principal: Principal, status: C.BoardFileExportStatus, input: C.BoardFileExportInput): Promise<void>;
  claimNext(workerId: string, leaseMs: number, concurrency: number): Promise<WhiteboardFileExportClaim | null>;
  renew(claim: WhiteboardFileExportClaim, progress: number, leaseMs: number): Promise<boolean>;
  complete(claim: WhiteboardFileExportClaim, status: C.BoardFileExportStatus, sha256: string): Promise<boolean>;
  finish(claim: WhiteboardFileExportClaim, status: C.BoardFileExportStatus): Promise<void>;
  claimCleanup(workerId: string): Promise<WhiteboardFileExportCleanup | null>;
  finishCleanup(cleanup: WhiteboardFileExportCleanup, deleted: boolean): Promise<void>;
  find(principal: Principal, jobId: string): Promise<WhiteboardFileExportRecord | null>;
  cancel(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus | null>;
}
export interface WhiteboardFileExportCleaner { purge(objectKey: string): Promise<boolean> }
export interface WhiteboardFileRenderer {
  hooks(objects: readonly WhiteboardObject[], format: C.BoardFileExportFormat, control: { signal: AbortSignal; deadlineAt: number }): Promise<import('@repo/whiteboard-core').BoardFileExportHooks>;
}

export interface WhiteboardFileExportService {
  create(principal: Principal, boardId: string, input: C.BoardFileExportInput): Promise<C.BoardFileExportStatus>;
  status(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus>;
  cancel(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus>;
  content(principal: Principal, jobId: string): Promise<WhiteboardFileExportContent>;
}
