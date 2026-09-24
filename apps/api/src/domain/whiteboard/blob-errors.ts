export type BoardBlobErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONTENT_CONFLICT'
  | 'INTEGRITY_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'ENCRYPTION_UNAVAILABLE';

export class BoardBlobError extends Error {
  constructor(readonly code: BoardBlobErrorCode, message: string = code) {
    super(message);
    this.name = 'BoardBlobError';
  }
}
