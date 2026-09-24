import type { whiteboard as W, whiteboardFileExport as C } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';

export const WHITEBOARD_FILE_EXPORT_SOURCE = Symbol('WhiteboardFileExportSource');
export const WHITEBOARD_FILE_EXPORT_SERVICE = Symbol('WhiteboardFileExportService');
export const WHITEBOARD_FILE_EXPORT_REPOSITORY = Symbol('WhiteboardFileExportRepository');
export const WHITEBOARD_FILE_RENDERER = Symbol('WhiteboardFileRenderer');

export type WhiteboardFileExportErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'BOUNDS_EXCEEDED' | 'NOT_READY';
export class WhiteboardFileExportError extends Error {
  constructor(readonly code: WhiteboardFileExportErrorCode) { super(code); this.name = 'WhiteboardFileExportError'; }
}

export interface WhiteboardFileExportSnapshot {
  readonly boardName: string;
  readonly role: W.Board['role'];
  readonly objects: readonly WhiteboardObject[];
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
export interface WhiteboardFileExportRepository {
  create(principal: Principal, status: C.BoardFileExportStatus, input: C.BoardFileExportInput): Promise<void>;
  running(principal: Principal, jobId: string, progress: number): Promise<void>;
  complete(principal: Principal, status: C.BoardFileExportStatus, objectKey: string, sha256: string): Promise<void>;
  finish(principal: Principal, status: C.BoardFileExportStatus): Promise<void>;
  find(principal: Principal, jobId: string): Promise<WhiteboardFileExportRecord | null>;
  cancel(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus | null>;
}
export interface WhiteboardFileRenderer {
  hooks(objects: readonly WhiteboardObject[], format: C.BoardFileExportFormat): Promise<import('@repo/whiteboard-core').BoardFileExportHooks>;
}

export interface WhiteboardFileExportService {
  create(principal: Principal, boardId: string, input: C.BoardFileExportInput): Promise<C.BoardFileExportStatus>;
  status(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus>;
  cancel(principal: Principal, jobId: string): Promise<C.BoardFileExportStatus>;
  content(principal: Principal, jobId: string): Promise<WhiteboardFileExportContent>;
}
